import type { APIRoute } from 'astro';
import { inngest } from '../../../lib/inngest/client';
import { json } from '../../../lib/http';
import { recordProviderEvent } from '../../../lib/services/enrollment';
import type { YousignWebhookPayload } from '../../../lib/services/yousign-events';
import { verifyYousignSignature } from '../../../lib/yousign';

/**
 * Template Method webhook Yousign: verify → record → enqueue → 200.
 */
export const POST: APIRoute = async ({ request }) => {
	const rawBody = await request.text();
	const signature =
		request.headers.get('x-yousign-signature-256') ??
		request.headers.get('x-yousign-signature');

	if (!verifyYousignSignature(rawBody, signature)) {
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

	const { created, id } = await recordProviderEvent({
		provider: 'yousign',
		providerEventId: eventId,
		eventType,
		payload,
	});

	if (!created || !id) {
		return json({ received: true, duplicate: true });
	}

	await inngest.send({
		name: 'provider/yousign-event.received',
		data: { providerEventId: id },
	});

	return json({ received: true });
};
