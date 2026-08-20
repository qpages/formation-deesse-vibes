/** NDA pleinement provisionné (brouillon activé + IDs persistés). */
export { isNdaFullyProvisioned } from './nda-request';

/** Lien App Yousign vers une demande de signature. */
export function yousignAppUrl(requestId?: string | null): string | null {
	if (!requestId) return null;
	return `https://yousign.app/auth/workspace/requests/${requestId}`;
}

export function signatureProviderLabel(provider: 'yousign' | 'docuseal'): string {
	return provider === 'docuseal' ? 'DocuSeal' : 'YouSign';
}

export function signatureProviderAppUrl(
	provider: 'yousign' | 'docuseal',
	requestId?: string | null,
): string | null {
	if (!requestId) return null;
	if (provider === 'docuseal') {
		return `https://docuseal.com/submissions/${requestId}`;
	}
	return yousignAppUrl(requestId);
}

export { resolveNdaProvider } from './nda-request';
