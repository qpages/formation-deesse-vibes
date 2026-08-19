import { sendInngestSafe, type EnqueueResult } from '../inngest/client';
import { applyAccessPolicy } from '../services/access';
import { findEnrollmentById } from '../services/enrollment';
import type { NdaSignatureProvider } from './nda-request';
import { resolveNdaProvider } from './nda-request';

/**
 * Post-condition unique : NDA signé → politique d’accès + enqueue invite Teachizy.
 * Idempotent (event id + job skip si déjà invité). Webhook et sync admin partagent ça.
 *
 * Expand-contract Slice 3 : émet `nda/signature.completed` et conserve `yousign/signature.done` pour YouSign.
 */
export async function ensureTeachizyAfterSignature(
	enrollmentId: string,
	sourceId: string,
	requestId: string,
	options?: { provider?: NdaSignatureProvider },
): Promise<EnqueueResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) return { status: 'skipped' };
	if (enrollment.contractStatus !== 'signed') return { status: 'skipped' };
	if (enrollment.teachizyInvitedAt && enrollment.accessStatus === 'active') {
		return { status: 'skipped' };
	}

	await applyAccessPolicy(enrollmentId);

	const provider = options?.provider ?? resolveNdaProvider(enrollment);

	let legacy: EnqueueResult = { status: 'skipped' };
	if (provider === 'yousign') {
		legacy = await sendInngestSafe({
			id: `teachizy-after-signature:yousign:${enrollmentId}`,
			name: 'yousign/signature.done',
			data: {
				enrollmentId,
				yousignEventId: sourceId,
				requestId,
			},
		});
	}

	const neutral = await sendInngestSafe({
		id: `teachizy-after-signature:nda:${enrollmentId}`,
		name: 'nda/signature.completed',
		data: {
			enrollmentId,
			providerEventId: sourceId,
			requestId,
		},
	});

	if (legacy.status === 'failed') return legacy;
	if (neutral.status === 'failed') return neutral;
	return { status: 'enqueued' };
}
