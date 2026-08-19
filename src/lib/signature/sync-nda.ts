import type { YousignRequestStatus } from '../../generated/prisma/client';
import { findEnrollmentById } from '../services/enrollment';
import { getSignatureOps } from './factory';
import { resolveNdaProvider } from './nda-request';
import type { SyncNdaStatusResult } from './types';

/** Aligne le statut NDA sur le provider (nda_requests.provider, fallback yousign). */
export async function syncNdaStatus(enrollmentId: string): Promise<SyncNdaStatusResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	return getSignatureOps(resolveNdaProvider(enrollment)).sync(enrollmentId);
}

type LegacySyncYousignFailure =
	| Exclude<Extract<SyncNdaStatusResult, { ok: false }>, { reason: 'no_nda_request' }>
	| { ok: false; reason: 'no_yousign_request'; detail?: string };

type LegacySyncYousignResult =
	| {
			ok: true;
			yousignStatus: YousignRequestStatus;
			providerStatus: string;
			followUp: Extract<SyncNdaStatusResult, { ok: true }>['followUp'];
	  }
	| LegacySyncYousignFailure;

/** Alias Slice 3 — mappe providerStatus → yousignStatus et no_nda_request → no_yousign_request. */
export async function syncYousignStatus(enrollmentId: string): Promise<LegacySyncYousignResult> {
	const result = await syncNdaStatus(enrollmentId);
	if (!result.ok) {
		if (result.reason === 'no_nda_request') {
			return { ok: false, reason: 'no_yousign_request', detail: result.detail };
		}
		return result;
	}
	return {
		ok: true,
		yousignStatus: result.providerStatus as YousignRequestStatus,
		providerStatus: result.providerStatus,
		followUp: result.followUp,
	};
}
