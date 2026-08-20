import { decryptPayload } from '../crypto';
import { eventOccurredAt } from '../signature/event-time';
import { findEnrollmentByExternalRequestOrEnrollmentId } from '../enrollment/queries';
import { confirmLearnerNdaSignatureFromWebhook } from '../signature/nda-sync';
import { persistNdaSyncMirror } from '../signature/persist';
import { resolveSignatureProvider } from '../signature/providers';
import { contractStatusFromYousignRequest, yousignStatusFromEvent } from '../status';
import { notifyOps } from './slack';

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

const ENGAGEMENT_EVENTS = new Set(['signer.notified', 'signer.link_opened']);

export type YousignWebhookPayload = {
	event_id?: string;
	event_name?: string;
	event_time?: string | number;
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
			status?: string;
		};
	};
};

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

export function isHandledYousignEventType(eventType: string) {
	return (
		eventType === 'signature_request.done' ||
		MONITOR_EVENTS.has(eventType) ||
		ENGAGEMENT_EVENTS.has(eventType)
	);
}

export async function handleYousignProviderEvent(input: {
	providerEventId: string;
	eventType: string;
	payloadCipherText: string | null;
}): Promise<{ enrollmentId?: string; ignored?: boolean }> {
	if (!isHandledYousignEventType(input.eventType)) {
		return { ignored: true };
	}
	if (!input.payloadCipherText) {
		throw new Error('ProviderEvent sans payload');
	}

	const payload = JSON.parse(decryptPayload(input.payloadCipherText)) as YousignWebhookPayload;
	const eventName = payload.event_name ?? input.eventType;
	const at = eventOccurredAt(payload);

	if (eventName === 'signer.notified' || eventName === 'signer.link_opened') {
		const { requestId, externalId } = extractRequestIds(payload);
		if (!requestId) return { ignored: true };

		const enrollment = await findEnrollmentByExternalRequestOrEnrollmentId(
			'yousign',
			requestId,
			externalId,
		);
		if (!enrollment) return { ignored: true };

		if (eventName === 'signer.notified') {
			await persistNdaSyncMirror(enrollment.id, {
				ndaNotifiedAt: enrollment.ndaNotifiedAt ?? at,
				providerStatus: 'ongoing',
			});
		} else {
			await persistNdaSyncMirror(enrollment.id, {
				ndaLinkOpenedAt: enrollment.ndaLinkOpenedAt ?? at,
			});
		}

		return { enrollmentId: enrollment.id };
	}

	if (eventName === 'signature_request.done') {
		const completed = resolveSignatureProvider('yousign').mapCompletedEvent(payload);
		if (!completed) throw new Error('signature_request.done sans request id');

		const enrollment = await findEnrollmentByExternalRequestOrEnrollmentId(
			'yousign',
			completed.requestId,
			completed.externalId,
		);
		if (!enrollment) {
			throw new Error(`Enrollment introuvable pour Yousign ${completed.requestId}`);
		}

		return confirmLearnerNdaSignatureFromWebhook(enrollment.id);
	}

	if (MONITOR_EVENTS.has(eventName)) {
		const { requestId, externalId } = extractRequestIds(payload);
		const enrollment = requestId
			? await findEnrollmentByExternalRequestOrEnrollmentId('yousign', requestId, externalId)
			: null;
		const reason = extractReason(payload);
		const yousignStatus = yousignStatusFromEvent(eventName);

		if (enrollment && yousignStatus) {
			const contractStatus = contractStatusFromYousignRequest(yousignStatus);
			const errorMessage = [`Yousign ${eventName}`, reason ? `raison=${reason}` : null]
				.filter(Boolean)
				.join(' | ');
			await persistNdaSyncMirror(enrollment.id, {
				providerStatus: yousignStatus,
				...(contractStatus && yousignStatus !== 'ongoing' ? { contractStatus } : {}),
				lastError: errorMessage,
				lastErrorAt: at,
				...(eventName === 'signer.notification_delivery_failed'
					? { ndaDeliveryFailedAt: enrollment.ndaDeliveryFailedAt ?? at }
					: {}),
			});
		}

		const actionHint =
			eventName === 'signer.notification_delivery_failed'
				? 'Action admin: vérifier e-mail acheteur / Renvoyer le lien de signature'
				: eventName === 'signature_request.deleted'
					? 'Action admin: Recréer un lien de signature ou rembourser'
					: 'Action admin: Renvoyer le lien (si expiré) ou Recréer un lien / rembourser';

		await notifyOps({
			kind: 'nda.monitor',
			severity: eventName.includes('error') || eventName.includes('deleted') ? 'critical' : 'warn',
			title: `Signature ${eventName}`,
			enrollmentId: enrollment?.id,
			email: enrollment?.user.email,
			detail: [
				requestId ? `requestId=${requestId}` : 'requestId manquant',
				reason ? `raison=${reason}` : null,
				actionHint,
			]
				.filter(Boolean)
				.join(' | '),
		});

		return { enrollmentId: enrollment?.id };
	}

	return { ignored: true };
}
