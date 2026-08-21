import { createProcessProviderWebhook } from './process-provider-webhook';
import { handleDocusealProviderEvent } from '../services/docuseal-events';

/** Command: traite un ProviderEvent DocuSeal (idempotent). */
export const processDocusealWebhook = createProcessProviderWebhook({
	id: 'process-docuseal-webhook',
	event: 'provider/docuseal-event.received',
	jobLabel: 'Webhook DocuSeal',
	handle: handleDocusealProviderEvent,
});
