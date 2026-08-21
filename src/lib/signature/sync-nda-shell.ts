import { findEnrollmentById, type EnrollmentWithUser } from '../enrollment/queries';
import { formatNdaSignedTitle } from './format-nda-signed-title';
import { resolveExternalRequestId } from './nda-request';
import { persistNdaSyncMirror } from './persist';
import { ensureTeachizyAfterSignature } from './after-signature';
import { notifyOps } from '../services/slack';
import type { SyncNdaStatusResult } from './types';

type SyncMirror = Parameters<typeof persistNdaSyncMirror>[1];

export type NdaProviderSyncSnapshot = {
	providerStatus: string;
	mirror: SyncMirror;
	isCompleted: boolean;
	completedAt?: Date;
};

/**
 * Shared application shell for signature-provider syncs. Provider adapters only
 * fetch and interpret remote state; the local mirror, notification, and
 * Teachizy follow-up stay identical for every provider.
 */
export async function syncNdaWithProvider(
	enrollmentId: string,
	source: string,
	readSnapshot: (
		enrollment: EnrollmentWithUser,
		requestId: string,
	) => Promise<NdaProviderSyncSnapshot | Extract<SyncNdaStatusResult, { ok: false }>>,
): Promise<SyncNdaStatusResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}

	const requestId = resolveExternalRequestId(enrollment);
	if (!requestId) {
		return { ok: false, reason: 'no_nda_request' };
	}

	const snapshot = await readSnapshot(enrollment, requestId);
	if (!('providerStatus' in snapshot)) return snapshot;

	const becameSigned = snapshot.isCompleted && enrollment.contractStatus !== 'signed';
	await persistNdaSyncMirror(enrollmentId, {
		providerStatus: snapshot.providerStatus,
		...snapshot.mirror,
	});

	if (becameSigned) {
		await notifyOps({
			kind: 'nda.signed',
			severity: 'info',
			title: formatNdaSignedTitle(
				enrollment.user.firstName,
				enrollment.user.lastName,
				snapshot.completedAt,
			),
			enrollmentId,
			email: enrollment.user.email,
		});
	}

	const followUp = snapshot.isCompleted
		? await ensureTeachizyAfterSignature(enrollmentId, `${source}:${enrollmentId}`, requestId)
		: { status: 'skipped' as const };

	return { ok: true, providerStatus: snapshot.providerStatus, followUp };
}
