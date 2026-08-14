import { createProcessProviderWebhook } from './process-provider-webhook';
import { handleYousignProviderEvent } from '../services/yousign-events';

/** Command: traite un ProviderEvent Yousign (idempotent). */
export const processYousignWebhook = createProcessProviderWebhook({
	id: 'process-yousign-webhook',
	event: 'provider/yousign-event.received',
	jobLabel: 'Webhook Yousign',
	handle: handleYousignProviderEvent,
});
