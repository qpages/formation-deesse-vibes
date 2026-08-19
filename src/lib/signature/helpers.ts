/** NDA pleinement provisionné (brouillon activé + IDs persistés). */
export { isNdaFullyProvisioned } from './nda-request';

/** Lien App Yousign vers une demande de signature. */
export function yousignAppUrl(requestId?: string | null): string | null {
	if (!requestId) return null;
	return `https://yousign.app/auth/workspace/requests/${requestId}`;
}
