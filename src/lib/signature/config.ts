import type { SignatureProvider, SignKind } from '../../generated/prisma/client';
import { getEnv, type ServerEnv } from '../env';

export type SignatureMode = 'embed' | 'redirect';

export type SignatureConfig = {
	provider: SignatureProvider;
	mode: SignatureMode;
	signKind: SignKind;
};

export function defaultSignatureMode(provider: SignatureProvider): SignatureMode {
	return provider === 'docuseal' ? 'embed' : 'redirect';
}

export function resolveSignKind(mode: SignatureMode): SignKind {
	return mode;
}

export function assertValidProviderModeCombo(
	provider: SignatureProvider,
	mode: SignatureMode,
): void {
	if (provider === 'yousign' && mode === 'embed') {
		throw new Error(
			'SIGNATURE_MODE=embed is not supported with SIGNATURE_PROVIDER=yousign. Use SIGNATURE_MODE=redirect (default).',
		);
	}
}

type SignatureEnv = Pick<ServerEnv, 'SIGNATURE_PROVIDER' | 'SIGNATURE_MODE'>;

export function resolveSignatureConfig(env?: SignatureEnv): SignatureConfig {
	const { SIGNATURE_PROVIDER, SIGNATURE_MODE } = env ?? getEnv();
	const provider = SIGNATURE_PROVIDER;
	const mode = SIGNATURE_MODE ?? defaultSignatureMode(provider);
	assertValidProviderModeCombo(provider, mode);
	return {
		provider,
		mode,
		signKind: resolveSignKind(mode),
	};
}
