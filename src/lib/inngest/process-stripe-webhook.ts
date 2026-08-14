import { createProcessProviderWebhook } from './process-provider-webhook';
import { handleStripeProviderEvent } from '../services/stripe-events';

/** Command: traite un ProviderEvent Stripe (idempotent). */
export const processStripeWebhook = createProcessProviderWebhook({
	id: 'process-stripe-webhook',
	event: 'provider/stripe-event.received',
	jobLabel: 'Webhook Stripe',
	handle: handleStripeProviderEvent,
});
