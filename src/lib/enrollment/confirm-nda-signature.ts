import type { EnqueueResult } from '../inngest/client';
import { isAwaitingNda } from '../enrollment-gates';
import { refreshNdaRequestStatus } from '../signature/refresh-nda-request-status';
import { findEnrollmentById } from './queries';

export type ConfirmNdaSignatureResult =
	| { ok: true; signed: true; followUp: EnqueueResult }
	| { ok: true; signed: false; followUp?: EnqueueResult }
	| {
			ok: false;
			reason: 'enrollment_not_found' | 'not_awaiting' | 'no_nda_request' | 'provider_error';
			detail?: string;
	  };

/**
 * Learner-side safety net: reads the signature provider and never marks an NDA
 * signed without provider confirmation. Idempotent when already signed locally.
 */
export async function confirmNdaSignature(enrollmentId: string): Promise<ConfirmNdaSignatureResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}

	if (enrollment.contractStatus === 'signed') {
		return { ok: true, signed: true, followUp: { status: 'skipped' } };
	}

	if (!isAwaitingNda(enrollment)) {
		return { ok: false, reason: 'not_awaiting' };
	}

	const result = await refreshNdaRequestStatus(enrollmentId);
	if (!result.ok) {
		return {
			ok: false,
			reason: result.reason === 'no_nda_request' ? 'no_nda_request' : 'provider_error',
			...(result.detail ? { detail: result.detail } : {}),
		};
	}

	const updated = await findEnrollmentById(enrollmentId);
	const signed = updated?.contractStatus === 'signed';

	if (signed) {
		return { ok: true, signed: true, followUp: result.followUp };
	}

	return { ok: true, signed: false, followUp: result.followUp };
}

/**
 * Webhook completion: uses the same confirmation path but retries when the
 * provider has not propagated the signature or the Teachizy follow-up failed.
 */
export async function confirmNdaSignatureFromWebhook(
	enrollmentId: string,
): Promise<{ enrollmentId: string }> {
	const result = await confirmNdaSignature(enrollmentId);
	if (!result.ok) {
		const detail = result.detail ? `: ${result.detail}` : '';
		throw new Error(`NDA sync échoué (${result.reason})${detail}`);
	}
	if (!result.signed) {
		throw new Error('Signature pas encore visible chez le provider — retry');
	}
	if (result.followUp.status === 'failed') {
		throw new Error(`Enqueue Teachizy échoué: ${result.followUp.error}`);
	}
	return { enrollmentId };
}
