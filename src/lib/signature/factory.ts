import { yousignAdapter, type YouSignAdapter } from './adapters/yousign';
import type { NdaSignatureProvider } from './nda-request';
import type { SignatureOps, SignaturePort, SignatureWebhookAdapter } from './types';
import { getEnv } from '../env';

function resolveProvider(): 'yousign' {
	const provider = getEnv().SIGNATURE_PROVIDER;
	if (provider !== 'yousign') {
		throw new Error(`Unsupported SIGNATURE_PROVIDER: ${provider}`);
	}
	return provider;
}

export function getSignaturePort(): SignaturePort {
	resolveProvider();
	return yousignAdapter;
}

export function getSignatureWebhookAdapter(): SignatureWebhookAdapter {
	resolveProvider();
	return yousignAdapter;
}

export function getSignatureOps(provider: NdaSignatureProvider): SignatureOps {
	if (provider !== 'yousign') {
		throw new Error(`Unsupported NDA provider: ${provider}`);
	}
	return yousignAdapter;
}

/** Sync/resend YouSign-specific — resend/recreate until Slice 4+. */
export function getSignatureAdapter(): YouSignAdapter {
	resolveProvider();
	return yousignAdapter;
}
