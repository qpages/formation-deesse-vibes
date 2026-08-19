import { yousignAdapter, type YouSignAdapter } from './adapters/yousign';
import type { SignaturePort, SignatureWebhookAdapter } from './types';
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

/** Accès adapter complet (sync / resend) — à retirer en Slice 2 via nda_requests. */
export function getSignatureAdapter(): YouSignAdapter {
	resolveProvider();
	return yousignAdapter;
}
