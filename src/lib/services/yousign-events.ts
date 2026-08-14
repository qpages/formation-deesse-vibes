import type { YousignRequestStatus } from '../../generated/prisma/client';
import { decryptPayload } from '../crypto';
import { sendInngestSafe, type EnqueueResult } from '../inngest/client';
import {
	contractStatusFromYousignRequest,
	mapYousignApiStatus,
	mapYousignSignerApiStatus,
	yousignStatusFromEvent,
} from '../status';
import { getSignatureRequest, getSigner } from '../yousign';
import { applyAccessPolicy } from './access';
import {
	findEnrollmentById,
	findEnrollmentByYousignRequestOrExternalId,
	recordYousignError,
	updateEnrollmentYousignMirror,
} from './enrollment';
import { formatErrorDetail, notifyOps } from './slack';

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

export type SyncYousignStatusResult =
	| { ok: true; yousignStatus: YousignRequestStatus; followUp: EnqueueResult }
	| {
			ok: false;
			reason:
				| 'enrollment_not_found'
				| 'no_yousign_request'
				| 'unmapped_status'
				| 'draft_not_activated';
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

function eventOccurredAt(payload: YousignWebhookPayload): Date {
	const raw = payload.event_time;
	if (typeof raw === 'number') {
		// Yousign envoie souvent un epoch unix (secondes).
		return new Date(raw > 1e12 ? raw : raw * 1000);
	}
	if (typeof raw === 'string' && raw.trim()) {
		const asNumber = Number(raw);
		if (!Number.isNaN(asNumber)) {
			return new Date(asNumber > 1e12 ? asNumber : asNumber * 1000);
		}
		const parsed = new Date(raw);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return new Date();
}

function formatNdaSignedTitle(firstName: string, lastName: string, at = new Date()) {
	const name = `${firstName} ${lastName}`.trim() || 'Un acheteur';
	const when = at.toLocaleString('fr-FR', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	});
	return `${name} a signé l'accord de confidentialité le ${when}`;
}

export function isHandledYousignEventType(eventType: string) {
	return (
		eventType === 'signature_request.done' ||
		MONITOR_EVENTS.has(eventType) ||
		ENGAGEMENT_EVENTS.has(eventType)
	);
}

/**
 * Aligne yousignStatus (+ contractStatus) et miroir Signer sur l’API Yousign.
 * Adapter = lecture SDK ; write ici (service).
 * Si la signature est done : même post-condition que le webhook (Teachizy).
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
	const rawStatus = remote.status?.toLowerCase() ?? '';

	// Un brouillon = demande jamais activée : ne PAS la faire passer pour « envoyée ».
	// On persiste le fait brut côté Yousign pour que l'admin voie du concret.
	if (rawStatus === 'draft') {
		const message = `demande en statut « draft » (jamais activée) — aucun signataire, aucun e-mail. « Recréer un lien Yousign » pour la (re)générer.`;
		await recordYousignError(enrollment.id, message);
		return { ok: false, reason: 'draft_not_activated', detail: remote.status };
	}

	const yousignStatus = mapYousignApiStatus(remote.status);
	if (!yousignStatus) {
		await recordYousignError(
			enrollment.id,
			`statut API inconnu « ${remote.status} » (non mappé).`,
		);
		return { ok: false, reason: 'unmapped_status', detail: remote.status };
	}

	const contractStatus = contractStatusFromYousignRequest(yousignStatus);
	const becameSigned =
		yousignStatus === 'done' && enrollment.contractStatus !== 'signed';

	const signerId = enrollment.yousignSignerId ?? remote.signers?.[0]?.id ?? null;
	const signerMirror: {
		yousignSignerId?: string | null;
		yousignSignerStatus?: ReturnType<typeof mapYousignSignerApiStatus>;
		signatureLinkExpiresAt?: Date | null;
		ndaSignedAt?: Date | null;
		ndaNotifiedAt?: Date | null;
		yousignLastError?: string | null;
		yousignLastErrorAt?: Date | null;
	} = {};

	if (signerId) {
		signerMirror.yousignSignerId = signerId;
		try {
			const signer = await getSigner(enrollment.yousignRequestId, signerId);
			const signerStatus = mapYousignSignerApiStatus(signer.status);
			if (signerStatus) signerMirror.yousignSignerStatus = signerStatus;
			signerMirror.signatureLinkExpiresAt = signer.signature_link_expiration_date
				? new Date(signer.signature_link_expiration_date)
				: null;
			if (signer.signed_at) {
				signerMirror.ndaSignedAt = new Date(signer.signed_at);
			}
			if (signerStatus === 'notified' && !enrollment.ndaNotifiedAt) {
				signerMirror.ndaNotifiedAt = new Date();
			}
			// Sync sain : on efface une éventuelle erreur périmée.
			signerMirror.yousignLastError = null;
			signerMirror.yousignLastErrorAt = null;
		} catch (error) {
			const detail = formatErrorDetail(error);
			console.warn('[syncYousignStatus] getSigner failed', error);
			signerMirror.yousignLastError = `lecture signataire échouée — ${detail}`;
			signerMirror.yousignLastErrorAt = new Date();
		}
	}

	await updateEnrollmentYousignMirror(enrollmentId, {
		yousignStatus,
		...(contractStatus ? { contractStatus } : {}),
		...signerMirror,
	});

	// Slack seulement sur vraie transition → signé (plus de spam au re-sync).
	if (becameSigned) {
		await notifyOps({
			kind: 'nda.signed',
			severity: 'info',
			title: formatNdaSignedTitle(enrollment.user.firstName, enrollment.user.lastName),
			enrollmentId,
			email: enrollment.user.email,
		});
	}

	// Effet secondaire best-effort : une file HS ne doit pas faire échouer le sync.
	const followUp: EnqueueResult =
		yousignStatus === 'done'
			? await ensureTeachizyAfterSignature(
					enrollmentId,
					`sync-yousign:${enrollmentId}`,
					enrollment.yousignRequestId,
				)
			: { status: 'skipped' };

	return { ok: true, yousignStatus, followUp };
}

/**
 * Post-condition unique : NDA signé → politique d’accès + enqueue invite Teachizy.
 * Idempotent (event id + job skip si déjà invité). Webhook et sync admin partagent ça.
 */
export async function ensureTeachizyAfterSignature(
	enrollmentId: string,
	sourceId: string,
	requestId: string,
): Promise<EnqueueResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) return { status: 'skipped' };
	if (enrollment.contractStatus !== 'signed') return { status: 'skipped' };
	if (enrollment.teachizyInvitedAt && enrollment.accessStatus === 'active') {
		return { status: 'skipped' };
	}

	await applyAccessPolicy(enrollmentId);

	return sendInngestSafe({
		id: `teachizy-after-signature:${enrollmentId}`,
		name: 'yousign/signature.done',
		data: {
			enrollmentId,
			yousignEventId: sourceId,
			requestId,
		},
	});
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
			yousignSignerStatus: 'signed',
			ndaSignedAt: enrollment.ndaSignedAt ?? at,
		});

		// Slack avant Teachizy : la notif signature ne dépend pas de l'invite.
		if (becameSigned) {
			await notifyOps({
				kind: 'nda.signed',
				severity: 'info',
				title: formatNdaSignedTitle(
					enrollment.user.firstName,
					enrollment.user.lastName,
					at,
				),
				enrollmentId: enrollment.id,
				email: enrollment.user.email,
			});
		}

		// Webhook = chemin « dur » : une file HS doit rejeter pour être rejouée.
		const followUp = await ensureTeachizyAfterSignature(
			enrollment.id,
			input.providerEventId,
			requestId,
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
				...(contractStatus && yousignStatus !== 'ongoing'
					? { contractStatus }
					: {}),
				yousignLastError: errorMessage,
				yousignLastErrorAt: at,
				...(eventName === 'signer.notification_delivery_failed'
					? {
							yousignSignerStatus: 'error' as const,
							ndaDeliveryFailedAt: enrollment.ndaDeliveryFailedAt ?? at,
						}
					: {}),
				...(eventName === 'signer.declined'
					? { yousignSignerStatus: 'declined' as const }
					: {}),
				...(eventName === 'signer.error'
					? { yousignSignerStatus: 'error' as const }
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
