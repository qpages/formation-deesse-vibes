import { formatErrorDetail } from '../../services/slack';
import { isSubmitterCompleted } from '../docuseal-send-copy';
import { recordNdaError } from '../persist';
import { resolveExternalSignerId } from '../nda-request';
import { syncNdaWithProvider } from '../sync-nda-shell';
import type { SyncNdaStatusResult } from '../types';
import type { DocusealSubmission, DocusealSubmitter } from './docuseal';

export async function syncDocusealNda(
	enrollmentId: string,
	remoteFns: {
		getSubmission(requestId: string): Promise<DocusealSubmission>;
		getSubmitter?(signerId: string): Promise<DocusealSubmitter>;
	},
): Promise<SyncNdaStatusResult> {
	return syncNdaWithProvider(enrollmentId, 'sync-docuseal', async (enrollment, requestId) => {
		let remote: DocusealSubmission;
		try {
			remote = await remoteFns.getSubmission(requestId);
		} catch (error) {
			const detail = formatErrorDetail(error);
			await recordNdaError(enrollment.id, `lecture DocuSeal échouée — ${detail}`);
			return { ok: false, reason: 'unmapped_status', detail };
		}

		const signerId = resolveExternalSignerId(enrollment);
		let submitter =
			(signerId
				? remote.submitters?.find((candidate) => String(candidate.id) === signerId)
				: undefined) ?? remote.submitters?.[0];

		if (remoteFns.getSubmitter && signerId && (!submitter || !isSubmitterCompleted(submitter))) {
			try {
				submitter = await remoteFns.getSubmitter(signerId);
			} catch {
				// keep submission payload when submitter lookup fails
			}
		}

		const rawStatus = remote.status?.toLowerCase() ?? '';
		const submitterCompleted = submitter ? isSubmitterCompleted(submitter) : false;
		const submissionCompleted = rawStatus === 'completed';
		const isCompleted = submissionCompleted || submitterCompleted;

		if (!rawStatus && !submitterCompleted) {
			await recordNdaError(enrollment.id, 'statut DocuSeal vide');
			return { ok: false, reason: 'unmapped_status', detail: remote.status };
		}

		const completedAt = remote.completed_at
			? new Date(remote.completed_at)
			: submitter?.completed_at
				? new Date(submitter.completed_at)
				: new Date();

		return {
			providerStatus: remote.status || submitter?.status || 'completed',
			isCompleted,
			completedAt,
			mirror: {
				...(isCompleted
					? {
							contractStatus: 'signed',
							ndaSignedAt: enrollment.ndaSignedAt ?? completedAt,
						}
					: rawStatus === 'pending'
						? { contractStatus: 'sent' }
						: {}),
				lastError: null,
				lastErrorAt: null,
			},
		};
	});
}
