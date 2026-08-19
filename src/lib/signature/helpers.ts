/** NDA pleinement provisionné (brouillon activé + IDs persistés). */
export function isNdaFullyProvisioned(enrollment: {
	yousignRequestId?: string | null;
	yousignSignerId?: string | null;
}): boolean {
	return Boolean(enrollment.yousignRequestId && enrollment.yousignSignerId);
}

/** Lien App Yousign vers une demande de signature. */
export function yousignAppUrl(requestId?: string | null): string | null {
	if (!requestId) return null;
	return `https://yousign.app/auth/workspace/requests/${requestId}`;
}
