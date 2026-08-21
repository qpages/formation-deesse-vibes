import {
	contractStatusFromYousignRequest,
	mapYousignApiStatus,
	mapYousignSignerApiStatus,
} from '../../status';
import { formatErrorDetail } from '../../services/slack';
import { recordNdaError } from '../persist';
import { resolveExternalSignerId } from '../nda-request';
import { syncNdaWithProvider } from '../sync-nda-shell';
import type { SyncNdaStatusResult } from '../types';
import type { YousignSignatureRequest, YousignSigner } from './yousign';

export async function syncYousignNda(
	enrollmentId: string,
	remoteFns: {
		getSignatureRequest(requestId: string): Promise<YousignSignatureRequest>;
		getSigner(requestId: string, signerId: string): Promise<YousignSigner>;
	},
): Promise<SyncNdaStatusResult> {
	return syncNdaWithProvider(enrollmentId, 'sync-nda', async (enrollment, requestId) => {
		let remote: YousignSignatureRequest;
		try {
			remote = await remoteFns.getSignatureRequest(requestId);
		} catch (error) {
			const detail = formatErrorDetail(error);
			await recordNdaError(enrollment.id, `lecture Yousign échouée — ${detail}`);
			return { ok: false, reason: 'unmapped_status', detail };
		}

		const rawStatus = remote.status?.toLowerCase() ?? '';

		if (rawStatus === 'draft') {
			const message = `demande en statut « draft » (jamais activée) — aucun signataire, aucun e-mail. « Recréer un lien de signature » pour la (re)générer.`;
			await recordNdaError(enrollment.id, message);
			return { ok: false, reason: 'draft_not_activated', detail: remote.status };
		}

		const yousignStatus = mapYousignApiStatus(remote.status);
		if (!yousignStatus) {
			await recordNdaError(enrollment.id, `statut API inconnu « ${remote.status} » (non mappé).`);
			return { ok: false, reason: 'unmapped_status', detail: remote.status };
		}

		const contractStatus = contractStatusFromYousignRequest(yousignStatus);

		const signerId = resolveExternalSignerId(enrollment) ?? remote.signers?.[0]?.id ?? null;
		const mirror: {
			externalSignerId?: string | null;
			signatureLinkExpiresAt?: Date | null;
			ndaSignedAt?: Date | null;
			ndaNotifiedAt?: Date | null;
			lastError?: string | null;
			lastErrorAt?: Date | null;
		} = {};

		if (signerId) {
			mirror.externalSignerId = signerId;
			try {
				const signer = await remoteFns.getSigner(requestId, signerId);
				const signerStatus = mapYousignSignerApiStatus(signer.status);
				mirror.signatureLinkExpiresAt = signer.signature_link_expiration_date
					? new Date(signer.signature_link_expiration_date)
					: null;
				if (signer.signed_at) {
					mirror.ndaSignedAt = new Date(signer.signed_at);
				}
				if (signerStatus === 'notified' && !enrollment.ndaNotifiedAt) {
					mirror.ndaNotifiedAt = new Date();
				}
				mirror.lastError = null;
				mirror.lastErrorAt = null;
			} catch (error) {
				const detail = formatErrorDetail(error);
				console.warn('[syncYousignNda] getSigner failed', error);
				mirror.lastError = `lecture signataire échouée — ${detail}`;
				mirror.lastErrorAt = new Date();
			}
		}

		return {
			providerStatus: yousignStatus,
			isCompleted: yousignStatus === 'done',
			completedAt: mirror.ndaSignedAt ?? undefined,
			mirror: {
				...(contractStatus ? { contractStatus } : {}),
				...mirror,
			},
		};
	});
}
