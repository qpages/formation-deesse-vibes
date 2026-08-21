import type { APIRoute } from 'astro';
import type { YousignWebhookPayload } from '../../../lib/services/yousign-events';
import { acknowledgeProviderEvent } from '../../../lib/webhooks/acknowledge-provider-event';
import { resolveSignatureProvider } from '../../../lib/signature/providers';

/**
 * Template Method webhook Yousign: verify → record → enqueue → 200.
 */
export const POST: APIRoute = async ({ request }) => {
	const rawBody = await request.text();
	const signature =
		request.headers.get('x-yousign-signature-256') ?? request.headers.get('x-yousign-signature');

	if (!resolveSignatureProvider('yousign').verify(rawBody, signature)) {
		return new Response('Invalid signature', { status: 400 });
	}

	let payload: YousignWebhookPayload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const eventType = payload.event_name ?? 'unknown';
	const eventId =
		payload.event_id ?? `${eventType}:${payload.data?.signature_request?.id ?? 'none'}`;

	return acknowledgeProviderEvent({
		provider: 'yousign',
		providerEventId: eventId,
		eventType,
		payload,
	});
};
