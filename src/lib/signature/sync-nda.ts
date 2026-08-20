import { findEnrollmentById } from '../enrollment';
import { getSignatureOps } from './factory';
import { resolveNdaProvider } from './nda-request';
import type { SyncNdaStatusResult } from './types';

/** Aligne le statut NDA sur le provider via nda_requests. */
export async function syncNdaStatus(enrollmentId: string): Promise<SyncNdaStatusResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	return getSignatureOps(resolveNdaProvider(enrollment)).sync(enrollmentId);
}
