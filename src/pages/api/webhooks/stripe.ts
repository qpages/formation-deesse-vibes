import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import {
	recordProcessedEvent,
	releaseProcessedEvent,
} from '../../../lib/services/enrollment';
import {
	confirmPaidCheckout,
	markSubscriptionScheduleCompleted,
	syncStripeInvoice,
	syncSubscriptionState,
} from '../../../lib/services/payment';
import { alertFinalFailure } from '../../../lib/services/slack';
import { constructStripeEvent } from '../../../lib/services/stripe';

const PAID_CHECKOUT_EVENTS = new Set([
	'checkout.session.completed',
	'checkout.session.async_payment_succeeded',
]);

export const POST: APIRoute = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		return new Response('Missing signature', { status: 400 });
	}

	const rawBody = await request.text();

	let event: Stripe.Event;
	try {
		event = constructStripeEvent(rawBody, signature);
	} catch (error) {
		console.error('[stripe webhook] signature', error);
		return new Response('Invalid signature', { status: 400 });
	}

	const { created } = await recordProcessedEvent({
		provider: 'stripe',
		eventId: event.id,
		payload: { type: event.type, id: event.id },
	});

	if (!created) {
		return json({ received: true, duplicate: true });
	}

	try {
		if (PAID_CHECKOUT_EVENTS.has(event.type)) {
			const session = event.data.object as Stripe.Checkout.Session;
			const result = await confirmPaidCheckout(session, { stripeEventId: event.id });
			if (!result.ok && result.reason.startsWith('payment_status=')) {
				return json({ received: true, deferred: true });
			}
			if (!result.ok) {
				throw new Error(result.reason);
			}
		} else if (event.type === 'invoice.paid') {
			const invoice = event.data.object as Stripe.Invoice;
			const result = await syncStripeInvoice(invoice, { stripeEventId: event.id });
			if (!result.ok && result.reason !== 'enrollment_not_found') {
				throw new Error(result.reason);
			}
		} else if (
			event.type === 'invoice.payment_failed' ||
			event.type === 'invoice.payment_action_required'
		) {
			const invoice = event.data.object as Stripe.Invoice;
			await syncStripeInvoice(invoice, {
				stripeEventId: event.id,
				forceStatus: event.type === 'invoice.payment_failed' ? 'failed' : 'open',
			});
		} else if (
			event.type === 'customer.subscription.updated' ||
			event.type === 'customer.subscription.deleted'
		) {
			const subscription = event.data.object as Stripe.Subscription;
			await syncSubscriptionState(subscription, { stripeEventId: event.id });
		} else if (event.type === 'subscription_schedule.completed') {
			const schedule = event.data.object as Stripe.SubscriptionSchedule;
			await markSubscriptionScheduleCompleted(schedule, { stripeEventId: event.id });
		} else if (
			event.type === 'charge.dispute.created' ||
			event.type === 'charge.dispute.funds_withdrawn'
		) {
			await handleDispute(event);
		}
	} catch (error) {
		console.error('[stripe webhook] handler', error);
		await releaseProcessedEvent('stripe', event.id);
		await alertFinalFailure({
			title: `Erreur traitement Stripe ${event.type}`,
			error: error instanceof Error ? error.message : String(error),
		});
		return new Response('Webhook handler failed', { status: 500 });
	}

	return json({ received: true });
};

async function handleDispute(event: Stripe.Event) {
	const dispute = event.data.object as Stripe.Dispute;
	await alertFinalFailure({
		title: 'Litige Stripe — décision manuelle requise',
		error: `Dispute ${dispute.id} — statut ${dispute.status}`,
	});
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
