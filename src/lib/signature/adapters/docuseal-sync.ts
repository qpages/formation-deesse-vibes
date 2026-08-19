import { findEnrollmentById } from '../../services/enrollment';
import { formatErrorDetail, notifyOps } from '../../services/slack';
import { ensureTeachizyAfterSignature } from '../after-signature';
import { persistDocusealSyncMirror, recordNdaError } from '../persist';
import { resolveExternalRequestId } from '../nda-request';
import type { SyncNdaStatusResult } from '../types';
import type { DocusealSubmission } from './docuseal';

function formatNdaSignedTitle(firstName: string, lastName: string, at = new Date()) {
	const name = `${firstName} ${lastName}`.trim() || 'Un acheteur';
	const when = at.toLocaleString('fr-FR', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	});
	return `${name} a signé le contrat de confidentialité le ${when}`;
}

export async function syncDocusealNda(
	enrollmentId: string,
	remoteFns: {
		getSubmission(requestId: string): Promise<DocusealSubmission>;
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

	let remote: DocusealSubmission;
	try {
		remote = await remoteFns.getSubmission(requestId);
	} catch (error) {
		const detail = formatErrorDetail(error);
		await recordNdaError(enrollment.id, `lecture DocuSeal échouée — ${detail}`);
		return { ok: false, reason: 'unmapped_status', detail };
	}

	const rawStatus = remote.status?.toLowerCase() ?? '';
	if (!rawStatus) {
		await recordNdaError(enrollment.id, 'statut DocuSeal vide');
		return { ok: false, reason: 'unmapped_status', detail: remote.status };
	}

	const becameSigned = rawStatus === 'completed' && enrollment.contractStatus !== 'signed';
	const completedAt = remote.completed_at ? new Date(remote.completed_at) : new Date();

	await persistDocusealSyncMirror(enrollmentId, {
		providerStatus: remote.status,
		...(rawStatus === 'completed'
			? {
					contractStatus: 'signed',
					ndaSignedAt: enrollment.ndaSignedAt ?? completedAt,
				}
			: rawStatus === 'pending'
				? { contractStatus: 'sent' }
				: {}),
		lastError: null,
		lastErrorAt: null,
	});

	if (becameSigned) {
		await notifyOps({
			kind: 'nda.signed',
			severity: 'info',
			title: formatNdaSignedTitle(
				enrollment.user.firstName,
				enrollment.user.lastName,
				completedAt,
			),
			enrollmentId,
			email: enrollment.user.email,
		});
	}

	const followUp =
		rawStatus === 'completed'
			? await ensureTeachizyAfterSignature(
					enrollmentId,
					`sync-docuseal:${enrollmentId}`,
					requestId,
					{ provider: 'docuseal' },
				)
			: { status: 'skipped' as const };

	return { ok: true, providerStatus: remote.status, followUp };
}
