import type { APIRoute } from 'astro';
import { getPrisma } from '../../../lib/db';
import { inngest } from '../../../lib/inngest/client';
import { recordProcessedEvent } from '../../../lib/services/enrollment';
import { alertFinalFailure } from '../../../lib/services/slack';
import { yousignStatusFromEvent } from '../../../lib/status';
import { verifyYousignSignature } from '../../../lib/services/yousign';

const MONITOR_EVENTS = new Set([
	'signature_request.declined',
	'signature_request.expired',
	'signature_request.canceled',
	'signature_request.rejected',
	'signature_request.deleted',
	'signer.declined',
	'signer.error',
	'signer.notification_delivery_failed',
]);

type YousignWebhookPayload = {
	event_id?: string;
	event_name?: string;
	data?: {
		signature_request?: {
			id?: string;
			external_id?: string;
			decline_reason?: string;
			rejection_reason?: string;
		};
		signer?: {
			id?: string;
			signature_request_id?: string;
			decline_reason?: string;
			error_reason?: string;
		};
	};
};

async function findEnrollment(requestId: string, externalId?: string) {
	return getPrisma().enrollment.findFirst({
		where: {
			OR: [
				{ yousignRequestId: requestId },
				...(externalId ? [{ id: externalId }] : []),
			],
		},
	});
}

function extractRequestIds(payload: YousignWebhookPayload) {
	const requestId =
		payload.data?.signature_request?.id ?? payload.data?.signer?.signature_request_id;
	const externalId = payload.data?.signature_request?.external_id;
	return { requestId, externalId };
}

function extractReason(payload: YousignWebhookPayload) {
	return (
		payload.data?.signature_request?.decline_reason ??
		payload.data?.signature_request?.rejection_reason ??
		payload.data?.signer?.decline_reason ??
		payload.data?.signer?.error_reason
	);
}

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
		const eventName = payload.event_name;

		if (eventName === 'signature_request.done') {
			const { requestId, externalId } = extractRequestIds(payload);
			if (!requestId) throw new Error('signature_request.done sans request id');

			const enrollment = await findEnrollment(requestId, externalId);
			if (!enrollment) {
				throw new Error(`Enrollment introuvable pour Yousign ${requestId}`);
			}

			await getPrisma().enrollment.update({
				where: { id: enrollment.id },
				data: { yousignStatus: 'done' },
			});

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
		} else if (eventName && MONITOR_EVENTS.has(eventName)) {
			const { requestId, externalId } = extractRequestIds(payload);
			const enrollment = requestId
				? await findEnrollment(requestId, externalId)
				: null;
			const reason = extractReason(payload);
			const yousignStatus = yousignStatusFromEvent(eventName);

			if (enrollment && yousignStatus) {
				await getPrisma().enrollment.update({
					where: { id: enrollment.id },
					data: { yousignStatus },
				});
			}

			const actionHint =
				eventName === 'signer.notification_delivery_failed'
					? 'Action admin: vérifier e-mail acheteur / Relancer NDA'
					: eventName === 'signature_request.deleted'
						? 'Action admin: Recréer NDA ou rembourser'
						: 'Action admin: Relancer (si expiré) ou Recréer NDA / rembourser';

			await alertFinalFailure({
				title: `Yousign ${eventName}`,
				enrollmentId: enrollment?.id,
				email: enrollment?.email,
				error: [
					requestId ? `requestId=${requestId}` : 'requestId manquant',
					reason ? `raison=${reason}` : null,
					actionHint,
				]
					.filter(Boolean)
					.join(' | '),
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
