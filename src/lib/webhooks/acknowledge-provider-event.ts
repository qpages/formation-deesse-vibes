import type { Provider } from '../../generated/prisma/client';
import { json } from '../http';
import { sendInngestSafe } from '../inngest/client';
import { recordProviderEvent } from '../services/provider-events';

const EVENT_NAME = {
	stripe: 'provider/stripe-event.received',
	yousign: 'provider/yousign-event.received',
	docuseal: 'provider/docuseal-event.received',
} as const;

function needsEnqueue(status: string | undefined): boolean {
	return status === 'received' || status === 'failed';
}

export async function acknowledgeProviderEvent(input: {
	provider: Provider;
	providerEventId: string;
	eventType: string;
	payload: unknown;
}): Promise<Response> {
	const recorded = await recordProviderEvent(input);
	if (!recorded.created && !needsEnqueue(recorded.status)) {
		return json({ received: true, duplicate: true });
	}

	if (!recorded.id) {
		return json({ error: 'Événement introuvable après enregistrement.' }, 500);
	}

	const send = await sendInngestSafe({
		name: EVENT_NAME[input.provider],
		data: { providerEventId: recorded.id },
	});
	if (send.status === 'failed') {
		return json({ error: 'File indisponible.' }, 500);
	}

	return json({ received: true, duplicate: !recorded.created });
}
