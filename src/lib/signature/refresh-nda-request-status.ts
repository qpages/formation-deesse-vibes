import { findEnrollmentById } from '../enrollment';
import { resolveSignatureProviderForEnrollment } from './providers';
import type { SyncNdaStatusResult } from './types';

/** Refreshes the local NDA-request status from its configured signature provider. */
export async function refreshNdaRequestStatus(enrollmentId: string): Promise<SyncNdaStatusResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	return resolveSignatureProviderForEnrollment(enrollment).syncStatus(enrollmentId);
}
