import type { YousignRequestStatus } from '../../../generated/prisma/client';
import {
	contractStatusFromYousignRequest,
	mapYousignApiStatus,
	mapYousignSignerApiStatus,
} from '../../status';
import { findEnrollmentById } from '../../services/enrollment';
import { formatErrorDetail, notifyOps } from '../../services/slack';
import { persistNdaSyncMirror, recordYousignError } from '../persist';
import { resolveExternalRequestId, resolveExternalSignerId } from '../nda-request';
import type { SyncNdaStatusResult } from '../types';
import type { YousignSignatureRequest, YousignSigner } from './yousign';

function formatNdaSignedTitle(firstName: string, lastName: string, at = new Date()) {
	const name = `${firstName} ${lastName}`.trim() || 'Un acheteur';
	const when = at.toLocaleString('fr-FR', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	});
	return `${name} a signé le contrat de confidentialité le ${when}`;
}

export async function syncYousignNda(
	enrollmentId: string,
	remoteFns: {
		getSignatureRequest(requestId: string): Promise<YousignSignatureRequest>;
		getSigner(requestId: string, signerId: string): Promise<YousignSigner>;
	},
): Promise<SyncNdaStatusResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	const requestId = resolveExternalRequestId(enrollment);
	if (!requestId) {
		return { ok: false, reason: 'no_nda_request' };
	}

	const remote = await remoteFns.getSignatureRequest(requestId);
	const rawStatus = remote.status?.toLowerCase() ?? '';

	if (rawStatus === 'draft') {
		const message = `demande en statut « draft » (jamais activée) — aucun signataire, aucun e-mail. « Recréer un lien Yousign » pour la (re)générer.`;
		await recordYousignError(enrollment.id, message);
		return { ok: false, reason: 'draft_not_activated', detail: remote.status };
	}

	const yousignStatus = mapYousignApiStatus(remote.status);
	if (!yousignStatus) {
		await recordYousignError(enrollment.id, `statut API inconnu « ${remote.status} » (non mappé).`);
		return { ok: false, reason: 'unmapped_status', detail: remote.status };
	}

	const contractStatus = contractStatusFromYousignRequest(yousignStatus);
	const becameSigned = yousignStatus === 'done' && enrollment.contractStatus !== 'signed';

	const signerId = resolveExternalSignerId(enrollment) ?? remote.signers?.[0]?.id ?? null;
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
			const signer = await remoteFns.getSigner(requestId, signerId);
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
			signerMirror.yousignLastError = null;
			signerMirror.yousignLastErrorAt = null;
		} catch (error) {
			const detail = formatErrorDetail(error);
			console.warn('[syncYousignNda] getSigner failed', error);
			signerMirror.yousignLastError = `lecture signataire échouée — ${detail}`;
			signerMirror.yousignLastErrorAt = new Date();
		}
	}

	await persistNdaSyncMirror(enrollmentId, {
		yousignStatus,
		providerStatus: remote.status,
		...(contractStatus ? { contractStatus } : {}),
		...signerMirror,
	});

	if (becameSigned) {
		await notifyOps({
			kind: 'nda.signed',
			severity: 'info',
			title: formatNdaSignedTitle(enrollment.user.firstName, enrollment.user.lastName),
			enrollmentId,
			email: enrollment.user.email,
		});
	}

	const followUp =
		yousignStatus === 'done'
			? await (
					await import('../after-signature')
				).ensureTeachizyAfterSignature(enrollmentId, `sync-nda:${enrollmentId}`, requestId)
			: { status: 'skipped' as const };

	return { ok: true, providerStatus: yousignStatus, followUp };
}
