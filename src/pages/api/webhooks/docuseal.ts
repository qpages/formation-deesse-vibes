import type { APIRoute } from 'astro';
import {
	isHandledDocusealEventType,
	synthesizeDocusealProviderEventId,
	type DocusealWebhookPayload,
} from '../../../lib/services/docuseal-events';
import { docusealAdapter } from '../../../lib/signature/adapters/docuseal';
import { acknowledgeProviderEvent } from '../../../lib/webhooks/acknowledge-provider-event';

/**
 * Template Method webhook DocuSeal: verify → record → enqueue → 200.
 */
export const POST: APIRoute = async ({ request }) => {
	const rawBody = await request.text();
	const signature = request.headers.get('x-docuseal-signature');

	if (!docusealAdapter.verify(rawBody, signature)) {
		return new Response('Invalid signature', { status: 400 });
	}

	let payload: DocusealWebhookPayload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const eventType = payload.event_type ?? 'unknown';
	if (!isHandledDocusealEventType(eventType)) {
		return new Response(JSON.stringify({ received: true, ignored: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const eventId = synthesizeDocusealProviderEventId(payload);

	return acknowledgeProviderEvent({
		provider: 'docuseal',
		providerEventId: eventId,
		eventType,
		payload,
	});
};
