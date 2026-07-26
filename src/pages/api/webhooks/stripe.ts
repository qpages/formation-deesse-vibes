import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { inngest } from '../../../lib/inngest/client';
import { getPrisma } from '../../../lib/db';
import {
	recordProcessedEvent,
	transitionStatus,
} from '../../../lib/services/enrollment';
import { alertFinalFailure } from '../../../lib/services/slack';
import { assertPriceMatches, constructStripeEvent } from '../../../lib/services/stripe';

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
		if (event.type === 'checkout.session.completed') {
			await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
		} else if (
			event.type === 'charge.dispute.created' ||
			event.type === 'charge.dispute.funds_withdrawn'
		) {
			await handleDispute(event);
		}
	} catch (error) {
		console.error('[stripe webhook] handler', error);
		await alertFinalFailure({
			title: `Erreur traitement Stripe ${event.type}`,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string) {
	await assertPriceMatches(session);

	const enrollmentId =
		session.metadata?.enrollmentId ?? session.client_reference_id ?? undefined;
	if (!enrollmentId) {
		throw new Error('checkout.session.completed sans enrollmentId');
	}

	const prisma = getPrisma();
	const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
	if (!enrollment) {
		throw new Error(`Enrollment introuvable: ${enrollmentId}`);
	}

	await recordProcessedEvent({
		provider: 'stripe',
		eventId: `${eventId}:link`,
		enrollmentId,
		payload: { sessionId: session.id },
	});

	const paymentIntentId =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: session.payment_intent?.id;

	const transitioned = await transitionStatus(
		enrollmentId,
		'paiement_en_attente',
		'paiement_confirme',
		{
			stripeCheckoutSessionId: session.id,
			stripePaymentIntentId: paymentIntentId,
			stripeCustomerId:
				typeof session.customer === 'string' ? session.customer : session.customer?.id,
		},
	);

	if (!transitioned && enrollment.status !== 'paiement_en_attente') {
		// Déjà traité — idempotent
		return;
	}

	await inngest.send({
		name: 'stripe/payment.confirmed',
		data: { enrollmentId, stripeEventId: eventId },
	});
}

async function handleDispute(event: Stripe.Event) {
	const dispute = event.data.object as Stripe.Dispute;
	await alertFinalFailure({
		title: 'Litige Stripe — décision manuelle requise',
		error: `Dispute ${dispute.id} — statut ${dispute.status}`,
	});
}
