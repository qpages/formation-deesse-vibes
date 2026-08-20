import { sendInngestSafe, type EnqueueResult } from '../inngest/client';
import { applyAccessPolicy } from '../enrollment/access';
import { findEnrollmentById } from '../enrollment';

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
		id: `teachizy-after-signature:nda:${enrollmentId}`,
		name: 'nda/signature.completed',
		data: {
			enrollmentId,
			providerEventId: sourceId,
			requestId,
		},
	});
}
