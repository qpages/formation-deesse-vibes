import { docusealAdapter } from './adapters/docuseal';
import { yousignAdapter } from './adapters/yousign';
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
