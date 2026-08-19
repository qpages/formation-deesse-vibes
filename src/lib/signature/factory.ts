import { docusealAdapter } from './adapters/docuseal';
import { yousignAdapter, type YouSignAdapter } from './adapters/yousign';
import type { NdaSignatureProvider } from './nda-request';
import type { SignatureOps, SignaturePort, SignatureWebhookAdapter } from './types';
import { getEnv } from '../env';

export type SignatureProviderName = 'yousign' | 'docuseal';

function resolveProvider(): SignatureProviderName {
	return getEnv().SIGNATURE_PROVIDER;
}

export function getSignaturePort(): SignaturePort {
	return resolveProvider() === 'docuseal' ? docusealAdapter : yousignAdapter;
}

export function getSignatureWebhookAdapter(): SignatureWebhookAdapter {
	return resolveProvider() === 'docuseal' ? docusealAdapter : yousignAdapter;
}

export function getSignatureOps(provider: NdaSignatureProvider): SignatureOps {
	return provider === 'docuseal' ? docusealAdapter : yousignAdapter;
}

/** Sync/resend YouSign-specific — unavailable when SIGNATURE_PROVIDER=docuseal. */
export function getSignatureAdapter(): YouSignAdapter {
	if (resolveProvider() !== 'yousign') {
		throw new Error('getSignatureAdapter() is only available when SIGNATURE_PROVIDER=yousign');
	}
	return yousignAdapter;
}
