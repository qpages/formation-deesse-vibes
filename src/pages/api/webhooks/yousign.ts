import type { APIRoute } from 'astro';
import { getPrisma } from '../../../lib/db';
import { inngest } from '../../../lib/inngest/client';
import { recordProcessedEvent } from '../../../lib/services/enrollment';
import { alertFinalFailure } from '../../../lib/services/slack';
import { verifyYousignSignature } from '../../../lib/services/yousign';

export const POST: APIRoute = async ({ request }) => {
	const rawBody = await request.text();
	const signature =
		request.headers.get('x-yousign-signature-256') ??
		request.headers.get('x-yousign-signature');

	if (!verifyYousignSignature(rawBody, signature)) {
		return new Response('Invalid signature', { status: 400 });
	}

	let payload: {
		event_id?: string;
		event_name?: string;
		data?: { signature_request?: { id?: string; external_id?: string } };
	};

	try {
		payload = JSON.parse(rawBody);
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const eventId = payload.event_id ?? `${payload.event_name}:${payload.data?.signature_request?.id}`;
	if (!eventId) {
		return new Response('Missing event id', { status: 400 });
	}

	const { created } = await recordProcessedEvent({
		provider: 'yousign',
		eventId,
		payload: { event_name: payload.event_name, id: eventId },
	});

	if (!created) {
		return new Response(JSON.stringify({ received: true, duplicate: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		if (payload.event_name === 'signature_request.done') {
			const requestId = payload.data?.signature_request?.id;
			const externalId = payload.data?.signature_request?.external_id;
			if (!requestId) throw new Error('signature_request.done sans request id');

			const enrollment = await getPrisma().enrollment.findFirst({
				where: {
					OR: [
						{ yousignRequestId: requestId },
						...(externalId ? [{ id: externalId }] : []),
					],
				},
			});

			if (!enrollment) {
				throw new Error(`Enrollment introuvable pour Yousign ${requestId}`);
			}

			await recordProcessedEvent({
				provider: 'yousign',
				eventId: `${eventId}:link`,
				enrollmentId: enrollment.id,
				payload: { requestId },
			});

			await inngest.send({
				name: 'yousign/signature.done',
				data: {
					enrollmentId: enrollment.id,
					yousignEventId: eventId,
					requestId,
				},
			});
		}
	} catch (error) {
		console.error('[yousign webhook]', error);
		await alertFinalFailure({
			title: 'Erreur traitement webhook Yousign',
			error: error instanceof Error ? error.message : String(error),
		});
	}

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
