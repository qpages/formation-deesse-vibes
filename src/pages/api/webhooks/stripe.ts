import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { inngest } from '../../../lib/inngest/client';
import { json } from '../../../lib/http';
import { recordProviderEvent } from '../../../lib/services/enrollment';
import { stripeEventPayload } from '../../../lib/services/stripe-events';
import { constructStripeEvent } from '../../../lib/stripe';

/**
 * Template Method webhook Stripe: verify → record → enqueue → 200.
 * Zéro sync métier inline.
 */
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

	const { created, id } = await recordProviderEvent({
		provider: 'stripe',
		providerEventId: event.id,
		eventType: event.type,
		payload: stripeEventPayload(event),
	});

	if (!created || !id) {
		return json({ received: true, duplicate: true });
	}

	await inngest.send({
		name: 'provider/stripe-event.received',
		data: { providerEventId: id },
	});

	return json({ received: true });
};
