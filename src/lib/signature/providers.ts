import { getEnv } from '../env';
import { docusealAdapter } from './adapters/docuseal';
import { yousignAdapter } from './adapters/yousign';
import type { NdaSignatureProvider } from './nda-request';
import { resolveNdaProvider } from './nda-request';
import type { SignatureProvider } from './types';

type EnrollmentNdaFields = Parameters<typeof resolveNdaProvider>[0];

let registry: Record<NdaSignatureProvider, SignatureProvider> | undefined;

function getRegistry(): Record<NdaSignatureProvider, SignatureProvider> {
	if (!registry) {
		registry = {
			yousign: yousignAdapter,
			docuseal: docusealAdapter,
		};
	}
	return registry;
}

export function resolveSignatureProvider(provider: NdaSignatureProvider): SignatureProvider {
	return getRegistry()[provider];
}

export function resolveSignatureProviderForEnrollment(
	enrollment: EnrollmentNdaFields,
): SignatureProvider {
	return resolveSignatureProvider(resolveNdaProvider(enrollment));
}

/** Provider actif (env SIGNATURE_PROVIDER) — création NDA pour nouvelles inscriptions. */
export function resolveDefaultSignatureProvider(): SignatureProvider {
	return resolveSignatureProvider(getEnv().SIGNATURE_PROVIDER);
}

/** Réinitialise le cache (tests uniquement). */
export function resetSignatureProvidersForTests() {
	registry = undefined;
}
