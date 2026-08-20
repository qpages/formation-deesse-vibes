import { isAwaitingNda } from '../enrollment-gates';
import { findEnrollmentById } from '../enrollment/queries';
import { syncNdaStatus } from './sync-nda';

export type ConfirmLearnerNdaSignatureResult =
	| { ok: true; signed: true }
	| { ok: true; signed: false }
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
		return { ok: true, signed: true };
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

	return { ok: true, signed: result.providerStatus === 'done' };
}
