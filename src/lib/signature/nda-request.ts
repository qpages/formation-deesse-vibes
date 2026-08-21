import type { NdaRequest, SignKind } from '../../generated/prisma/client';

export type NdaRequestLookup = {
	externalRequestId: string;
	externalSignerId: string | null;
};

type EnrollmentNdaFields = {
	ndaRequest?: Pick<NdaRequest, 'provider' | 'externalRequestId' | 'externalSignerId'> | null;
};

export type NdaSignatureProvider = 'yousign' | 'docuseal';

export function resolveNdaProvider(enrollment: EnrollmentNdaFields): NdaSignatureProvider {
	return (enrollment.ndaRequest?.provider ?? 'yousign') as NdaSignatureProvider;
}

export function resolveNdaRequestIds(enrollment: EnrollmentNdaFields): NdaRequestLookup | null {
	if (!enrollment.ndaRequest) return null;
	return {
		externalRequestId: enrollment.ndaRequest.externalRequestId,
		externalSignerId: enrollment.ndaRequest.externalSignerId,
	};
}

export function resolveExternalRequestId(enrollment: EnrollmentNdaFields): string | null {
	return resolveNdaRequestIds(enrollment)?.externalRequestId ?? null;
}

export function resolveExternalSignerId(enrollment: EnrollmentNdaFields): string | null {
	return resolveNdaRequestIds(enrollment)?.externalSignerId ?? null;
}

type EnrollmentSignKindFields = {
	ndaRequest?: Pick<NdaRequest, 'signKind'> | null;
};

/** signKind persisté sur nda_requests ; défaut redirect. */
export function resolveSignKind(enrollment: EnrollmentSignKindFields): SignKind {
	return enrollment.ndaRequest?.signKind ?? 'redirect';
}

/** NDA pleinement provisionné (brouillon activé + IDs persistés). */
export function isNdaFullyProvisioned(enrollment: EnrollmentNdaFields): boolean {
	const ids = resolveNdaRequestIds(enrollment);
	return Boolean(ids?.externalRequestId && ids.externalSignerId);
}
