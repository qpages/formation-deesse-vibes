import type { EnqueueResult } from '../inngest/client';
import { isAwaitingNda } from '../enrollment-gates';
import { findEnrollmentById } from '../enrollment/queries';
import { syncNdaStatus } from './sync-nda';

export type ConfirmLearnerNdaSignatureResult =
	| { ok: true; signed: true; followUp: EnqueueResult }
	| { ok: true; signed: false; followUp?: EnqueueResult }
	| {
			ok: false;
			reason: 'enrollment_not_found' | 'not_awaiting' | 'no_nda_request' | 'provider_error';
			detail?: string;
	  };

/**
 * Filet élève : lit le provider de signature, ne pose jamais `signed` à la main.
 * Idempotent si le contrat est déjà signé en DB.
 */
export async function confirmLearnerNdaSignature(
	enrollmentId: string,
): Promise<ConfirmLearnerNdaSignatureResult> {
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

	const result = await syncNdaStatus(enrollmentId);
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
 * Webhook completion : même chemin que l’élève, mais retry si le provider
 * n’a pas encore propagé la signature ou si l’enqueue Teachizy a échoué.
 */
export async function confirmLearnerNdaSignatureFromWebhook(
	enrollmentId: string,
): Promise<{ enrollmentId: string }> {
	const result = await confirmLearnerNdaSignature(enrollmentId);
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
