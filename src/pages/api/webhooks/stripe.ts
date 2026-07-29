import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import {
	recordProcessedEvent,
	releaseProcessedEvent,
} from '../../../lib/services/enrollment';
import { confirmPaidCheckout } from '../../../lib/services/payment';
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
		return new Response(JSON.stringify({ received: true, duplicate: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		if (PAID_CHECKOUT_EVENTS.has(event.type)) {
			const session = event.data.object as Stripe.Checkout.Session;
			const result = await confirmPaidCheckout(session, { stripeEventId: event.id });
			if (!result.ok && result.reason.startsWith('payment_status=')) {
				// Paiement différé — attendre async_payment_succeeded
				return json({ received: true, deferred: true });
			}
			if (!result.ok) {
				throw new Error(result.reason);
			}
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
