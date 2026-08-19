import type { YousignRequestStatus } from '../../generated/prisma/client';
import { decryptPayload } from '../crypto';
import { ensureTeachizyAfterSignature } from '../signature/after-signature';
import { eventOccurredAt } from '../signature/event-time';
import { yousignAdapter } from '../signature/adapters/yousign';
import type { SyncNdaStatusResult } from '../signature/types';
import { syncNdaStatus, syncYousignStatus } from '../signature/sync-nda';
import { contractStatusFromYousignRequest, yousignStatusFromEvent } from '../status';
import {
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

/** @deprecated Préférer SyncNdaStatusResult — yousignStatus alias de providerStatus pour YouSign. */
export type SyncYousignStatusResult =
	| (Extract<SyncNdaStatusResult, { ok: true }> & { yousignStatus: YousignRequestStatus })
	| Extract<SyncNdaStatusResult, { ok: false }>
	| { ok: false; reason: 'no_yousign_request'; detail?: string };

export { ensureTeachizyAfterSignature, syncNdaStatus, syncYousignStatus };

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

function formatNdaSignedTitle(firstName: string, lastName: string, at = new Date()) {
	const name = `${firstName} ${lastName}`.trim() || 'Un acheteur';
	const when = at.toLocaleString('fr-FR', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	});
	return `${name} a signé le contrat de confidentialité le ${when}`;
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

		const enrollment = await findEnrollmentByYousignRequestOrExternalId(requestId, externalId);
		if (!enrollment) return { ignored: true };

		if (eventName === 'signer.notified') {
			await updateEnrollmentYousignMirror(enrollment.id, {
				yousignSignerStatus: 'notified',
				ndaNotifiedAt: enrollment.ndaNotifiedAt ?? at,
			});
		} else {
			await updateEnrollmentYousignMirror(enrollment.id, {
				ndaLinkOpenedAt: enrollment.ndaLinkOpenedAt ?? at,
			});
		}

		return { enrollmentId: enrollment.id };
	}

	if (eventName === 'signature_request.done') {
		const completed = yousignAdapter.mapCompletedEvent(payload);
		if (!completed) throw new Error('signature_request.done sans request id');

		const enrollment = await findEnrollmentByYousignRequestOrExternalId(
			completed.requestId,
			completed.externalId,
		);
		if (!enrollment) {
			throw new Error(`Enrollment introuvable pour Yousign ${completed.requestId}`);
		}

		const becameSigned = enrollment.contractStatus !== 'signed';
		const at = completed.occurredAt;

		await updateEnrollmentYousignMirror(enrollment.id, {
			yousignStatus: 'done',
			contractStatus: 'signed',
			yousignSignerStatus: 'signed',
			ndaSignedAt: enrollment.ndaSignedAt ?? at,
		});

		// Slack avant Teachizy : la notif signature ne dépend pas de l'invite.
		if (becameSigned) {
			await notifyOps({
				kind: 'nda.signed',
				severity: 'info',
				title: formatNdaSignedTitle(enrollment.user.firstName, enrollment.user.lastName, at),
				enrollmentId: enrollment.id,
				email: enrollment.user.email,
			});
		}

		// Webhook = chemin « dur » : une file HS doit rejeter pour être rejouée.
		const followUp = await ensureTeachizyAfterSignature(
			enrollment.id,
			input.providerEventId,
			completed.requestId,
		);
		if (followUp.status === 'failed') {
			throw new Error(`Enqueue Teachizy échoué: ${followUp.error}`);
		}

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
			const contractStatus = contractStatusFromYousignRequest(yousignStatus);
			const errorMessage = [`Yousign ${eventName}`, reason ? `raison=${reason}` : null]
				.filter(Boolean)
				.join(' | ');
			await updateEnrollmentYousignMirror(enrollment.id, {
				yousignStatus,
				...(contractStatus && yousignStatus !== 'ongoing' ? { contractStatus } : {}),
				yousignLastError: errorMessage,
				yousignLastErrorAt: at,
				...(eventName === 'signer.notification_delivery_failed'
					? {
							yousignSignerStatus: 'error' as const,
							ndaDeliveryFailedAt: enrollment.ndaDeliveryFailedAt ?? at,
						}
					: {}),
				...(eventName === 'signer.declined' ? { yousignSignerStatus: 'declined' as const } : {}),
				...(eventName === 'signer.error' ? { yousignSignerStatus: 'error' as const } : {}),
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
			severity: eventName.includes('error') || eventName.includes('deleted') ? 'critical' : 'warn',
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
