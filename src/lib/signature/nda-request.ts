import type { NdaRequest } from '../../generated/prisma/client';

export type NdaRequestLookup = {
	externalRequestId: string;
	externalSignerId: string | null;
};

type EnrollmentNdaFields = {
	yousignRequestId?: string | null;
	yousignSignerId?: string | null;
	ndaRequest?: Pick<NdaRequest, 'provider' | 'externalRequestId' | 'externalSignerId'> | null;
};

export type NdaSignatureProvider = 'yousign';

/** Dual-read provider: nda_requests first, fallback yousign. */
export function resolveNdaProvider(enrollment: EnrollmentNdaFields): NdaSignatureProvider {
	return (enrollment.ndaRequest?.provider ?? 'yousign') as NdaSignatureProvider;
}

/** Dual-read: nda_requests first, fallback enrollment yousign* columns. */
export function resolveNdaRequestIds(enrollment: EnrollmentNdaFields): NdaRequestLookup | null {
	if (enrollment.ndaRequest) {
		return {
			externalRequestId: enrollment.ndaRequest.externalRequestId,
			externalSignerId: enrollment.ndaRequest.externalSignerId,
		};
	}
	if (enrollment.yousignRequestId) {
		return {
			externalRequestId: enrollment.yousignRequestId,
			externalSignerId: enrollment.yousignSignerId ?? null,
		};
	}
	return null;
}

export function resolveExternalRequestId(enrollment: EnrollmentNdaFields): string | null {
	return resolveNdaRequestIds(enrollment)?.externalRequestId ?? null;
}

export function resolveExternalSignerId(enrollment: EnrollmentNdaFields): string | null {
	return resolveNdaRequestIds(enrollment)?.externalSignerId ?? null;
}

/** NDA pleinement provisionné (brouillon activé + IDs persistés). */
export function isNdaFullyProvisioned(enrollment: EnrollmentNdaFields): boolean {
	const ids = resolveNdaRequestIds(enrollment);
	return Boolean(ids?.externalRequestId && ids.externalSignerId);
}
