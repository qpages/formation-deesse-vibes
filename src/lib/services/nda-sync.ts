import { isAwaitingNda } from '../enrollment-gates';
import { syncNdaStatus } from '../signature/sync-nda';
import { findEnrollmentById } from './enrollment';

export type ConfirmLearnerNdaSignatureResult =
	| { ok: true; signed: true }
	| { ok: true; signed: false }
	| {
			ok: false;
			reason: 'enrollment_not_found' | 'not_awaiting' | 'no_yousign_request' | 'yousign_error';
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
		return { ok: true, signed: true };
	}

	if (!isAwaitingNda(enrollment)) {
		return { ok: false, reason: 'not_awaiting' };
	}

	const result = await syncNdaStatus(enrollmentId);
	if (!result.ok) {
		if (result.reason === 'no_nda_request') {
			return { ok: false, reason: 'no_yousign_request' };
		}
		return { ok: false, reason: 'yousign_error', detail: result.reason };
	}

	return { ok: true, signed: result.providerStatus === 'done' };
}
