import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { stripeEventPayload } from '../../../lib/services/stripe-events';
import { constructStripeEvent } from '../../../lib/stripe';
import { acknowledgeProviderEvent } from '../../../lib/webhooks/acknowledge-provider-event';

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

	return acknowledgeProviderEvent({
		provider: 'stripe',
		providerEventId: event.id,
		eventType: event.type,
		payload: stripeEventPayload(event),
	});
};
