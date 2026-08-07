import type { YousignRequestStatus } from '../../generated/prisma/client';
import { decryptPayload } from '../crypto';
import { inngest } from '../inngest/client';
import { mapYousignApiStatus, yousignStatusFromEvent } from '../status';
import { getSignatureRequest } from '../yousign';
import { applyAccessPolicy } from './access';
import {
	findEnrollmentById,
	findEnrollmentByYousignRequestOrExternalId,
	updateEnrollmentYousignMirror,
} from './enrollment';
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

export type YousignWebhookPayload = {
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

export type SyncYousignStatusResult =
	| { ok: true; yousignStatus: YousignRequestStatus }
	| {
			ok: false;
			reason: 'enrollment_not_found' | 'no_yousign_request' | 'unmapped_status';
			detail?: string;
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
	return eventType === 'signature_request.done' || MONITOR_EVENTS.has(eventType);
}

/**
 * Aligne yousignStatus (+ contractStatus si done) sur l’API Yousign.
 * Adapter = lecture SDK ; write ici (service).
 */
export async function syncYousignStatus(
	enrollmentId: string,
): Promise<SyncYousignStatusResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	if (!enrollment.yousignRequestId) {
		return { ok: false, reason: 'no_yousign_request' };
	}

	const remote = await getSignatureRequest(enrollment.yousignRequestId);
	const yousignStatus = mapYousignApiStatus(remote.status);
	if (!yousignStatus) {
		return { ok: false, reason: 'unmapped_status', detail: remote.status };
	}

	const becameSigned =
		yousignStatus === 'done' && enrollment.contractStatus !== 'signed';

	await updateEnrollmentYousignMirror(enrollmentId, {
		yousignStatus,
		...(yousignStatus === 'done' ? { contractStatus: 'signed' as const } : {}),
	});

	if (becameSigned) {
		await notifyOps({
			kind: 'nda.signed',
			severity: 'info',
			title: 'NDA signé',
			enrollmentId,
			email: enrollment.user.email,
			detail: `sync Yousign → ${yousignStatus}`,
		});
		await applyAccessPolicy(enrollmentId);
	}

	return { ok: true, yousignStatus };
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

	if (eventName === 'signature_request.done') {
		const { requestId, externalId } = extractRequestIds(payload);
		if (!requestId) throw new Error('signature_request.done sans request id');

		const enrollment = await findEnrollmentByYousignRequestOrExternalId(requestId, externalId);
		if (!enrollment) {
			throw new Error(`Enrollment introuvable pour Yousign ${requestId}`);
		}

		const becameSigned = enrollment.contractStatus !== 'signed';

		await updateEnrollmentYousignMirror(enrollment.id, {
			yousignStatus: 'done',
			contractStatus: 'signed',
		});

		await applyAccessPolicy(enrollment.id);

		if (becameSigned) {
			await notifyOps({
				kind: 'nda.signed',
				severity: 'info',
				title: 'NDA signé',
				enrollmentId: enrollment.id,
				email: enrollment.user.email,
			});
		}

		await inngest.send({
			name: 'yousign/signature.done',
			data: {
				enrollmentId: enrollment.id,
				yousignEventId: input.providerEventId,
				requestId,
			},
		});

		return { enrollmentId: enrollment.id };
	}

	if (MONITOR_EVENTS.has(eventName)) {
		const { requestId, externalId } = extractRequestIds(payload);
		const enrollment = requestId
			? await findEnrollmentByYousignRequestOrExternalId(requestId, externalId)
			: null;
		const reason = extractReason(payload);
		const yousignStatus = yousignStatusFromEvent(eventName);

		if (enrollment && yousignStatus) {
			await updateEnrollmentYousignMirror(enrollment.id, {
				yousignStatus,
				...(yousignStatus === 'expired' || yousignStatus === 'declined'
					? {
							contractStatus:
								yousignStatus === 'expired'
									? ('expired' as const)
									: ('declined' as const),
						}
					: {}),
			});
		}

		const actionHint =
			eventName === 'signer.notification_delivery_failed'
				? 'Action admin: vérifier e-mail acheteur / Renvoyer le lien Yousign'
				: eventName === 'signature_request.deleted'
					? 'Action admin: Recréer un lien Yousign ou rembourser'
					: 'Action admin: Renvoyer le lien Yousign (si expiré) ou Recréer un lien Yousign / rembourser';

		await notifyOps({
			kind: 'nda.monitor',
			severity: eventName.includes('error') || eventName.includes('deleted')
				? 'critical'
				: 'warn',
			title: `Yousign ${eventName}`,
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
