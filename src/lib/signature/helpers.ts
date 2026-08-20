import { resolveSignatureConfig } from './config';
import type { SignatureConfig } from './config';

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

export function signatureProviderLandingUrl(provider: 'yousign' | 'docuseal'): string {
	return provider === 'docuseal' ? 'https://docuseal.eu/' : 'https://yousign.com/';
}

const SIGNATURE_PROVIDER_LINK_CLASS = 'hover:underline underline-offset-2';
const DOCUSEAL_MARK_SRC = '/icons/docuseal-mark.svg';

export function signatureProviderLink(provider: 'yousign' | 'docuseal'): string {
	const label = signatureProviderLabel(provider);
	const url = signatureProviderLandingUrl(provider);

	if (provider === 'docuseal') {
		return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="stepper__provider-link ${SIGNATURE_PROVIDER_LINK_CLASS}"><span class="stepper__provider-mark">${label}<img src="${DOCUSEAL_MARK_SRC}" alt="" width="14" height="14" class="stepper__provider-logo" /></span></a>`;
	}

	return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${SIGNATURE_PROVIDER_LINK_CLASS}">${label}</a>`;
}

export type SignatureStepCopy = { title: string; text: string };

export function resolveSignatureStepCopy(config?: SignatureConfig): SignatureStepCopy {
	const { provider, mode } = config ?? resolveSignatureConfig();
	const providerLink = signatureProviderLink(provider);

	if (mode === 'embed') {
		return {
			title: 'Vous signez le contrat de confidentialité sur cette page',
			text: `Signature électronique intégrée via ${providerLink} dès confirmation du paiement.`,
		};
	}

	return {
		title: 'Vous signez le contrat de confidentialité par e-mail',
		text: `Signature électronique via le lien ${providerLink} qui sera envoyé dès confirmation du paiement.`,
	};
}

export function resolveSignatureConsentCopy(config?: SignatureConfig): string {
	const { mode } = config ?? resolveSignatureConfig();

	if (mode === 'embed') {
		return 'Je m’engage à signer le contrat de confidentialité sur cette page après paiement. Sans signature, l’accès à la formation sur Teachizy ne sera pas possible.';
	}

	return 'Je m’engage à signer le contrat de confidentialité qui me sera envoyé par e-mail après paiement. Sans signature, l’accès à la formation sur Teachizy ne sera pas possible.';
}

export type SignatureStatusCopy = {
	signSurfaceReady: string;
	signSurfaceWaiting: string;
	signSurfaceUnavailable: string;
};

export function resolveSignatureStatusCopy(config?: SignatureConfig): SignatureStatusCopy {
	const { mode } = config ?? resolveSignatureConfig();

	if (mode === 'embed') {
		return {
			signSurfaceReady: 'Votre contrat est prêt à signer ci-dessous.',
			signSurfaceWaiting:
				'Votre paiement est bien confirmé. Le contrat apparaît ici dès qu’il est prêt.',
			signSurfaceUnavailable:
				'Votre accord est prêt, mais le formulaire n’est pas encore disponible. Actualisez la page ou contactez un administrateur.',
		};
	}

	return {
		signSurfaceReady: 'Le lien de signature est prêt.',
		signSurfaceWaiting:
			'Votre paiement est bien confirmé. Le lien de signature apparaît ici dès qu’il est prêt.',
		signSurfaceUnavailable:
			'Votre accord est prêt, mais le lien n’est pas encore disponible. Actualisez la page ou contactez un administrateur.',
	};
}

export function resolveSignatureCheckoutFlashCopy(
	contractStatus: 'pending' | 'sent',
	config?: SignatureConfig,
): string {
	const { mode } = config ?? resolveSignatureConfig();

	if (contractStatus === 'sent') {
		return mode === 'embed'
			? 'Paiement reçu. Signez votre contrat de confidentialité ci-dessous pour continuer.'
			: 'Paiement reçu. Signez votre contrat de confidentialité pour continuer.';
	}

	return 'Paiement reçu. Nous préparons votre contrat de confidentialité.';
}

export type SignatureFaqItem = { q: string; a: string };

export function resolveSignatureMissingSignFaq(
	contactEmail: string,
	config?: SignatureConfig,
): SignatureFaqItem {
	const { mode } = config ?? resolveSignatureConfig();
	const mailtoHref = `mailto:${contactEmail}?subject=${encodeURIComponent('Lien de signature contrat de confidentialité manquant')}`;

	if (mode === 'embed') {
		return {
			q: 'J’ai payé mais je ne vois pas le contrat à signer',
			a: `Pas d’inquiétude. Actualisez la page, puis contactez un administrateur à <a href="${mailtoHref}" class="underline underline-offset-2 hover:text-ink">${contactEmail}</a>, on débloque ça rapidement.`,
		};
	}

	return {
		q: 'J’ai payé mais je ne reçois pas de lien pour signer',
		a: `Pas d’inquiétude. Vérifiez d’abord vos spams, puis contactez un administrateur à <a href="${mailtoHref}" class="underline underline-offset-2 hover:text-ink">${contactEmail}</a>, on débloque ça rapidement.`,
	};
}

export type SignaturePrivacyDisclosure = {
	providerName: string;
	privacyUrl: string;
};

export function resolveSignaturePrivacyDisclosure(
	config?: SignatureConfig,
): SignaturePrivacyDisclosure {
	const { provider } = config ?? resolveSignatureConfig();

	if (provider === 'docuseal') {
		return {
			providerName: 'DocuSeal',
			privacyUrl: 'https://www.docuseal.eu/privacy',
		};
	}

	return {
		providerName: 'Yousign',
		privacyUrl: 'https://yousign.com/fr-fr/politique-de-confidentialite',
	};
}

export function resolveSignatureCgvEnrollmentStep(config?: SignatureConfig): string {
	const { provider, mode } = config ?? resolveSignatureConfig();
	const providerLabel = signatureProviderLabel(provider);

	if (mode === 'embed') {
		return 'Signature électronique du contrat de confidentialité sur cette page (dès confirmation du paiement) ;';
	}

	return `Signature électronique du contrat de confidentialité via ${providerLabel} (lien envoyé par e-mail) ;`;
}

export function signatureProviderAppUrl(
	provider: 'yousign' | 'docuseal',
	requestId?: string | null,
): string | null {
	if (!requestId) return null;
	if (provider === 'docuseal') {
		return `https://docuseal.eu/submissions/${requestId}`;
	}
	return yousignAppUrl(requestId);
}

export { resolveNdaProvider } from './nda-request';
