import { describe, expect, it } from 'vitest';
import {
	resolveSignatureCgvEnrollmentStep,
	resolveSignatureCheckoutFlashCopy,
	resolveSignatureConsentCopy,
	resolveSignatureMissingSignFaq,
	resolveSignaturePrivacyDisclosure,
	resolveSignatureStatusCopy,
	resolveSignatureStepCopy,
	signatureProviderLink,
} from './helpers';

describe('resolveSignatureStepCopy', () => {
	it('yousign redirect → e-mail + lien YouSign', () => {
		expect(
			resolveSignatureStepCopy({ provider: 'yousign', mode: 'redirect', signKind: 'redirect' }),
		).toEqual({
			title: 'Vous signez le contrat de confidentialité par e-mail',
			text: `Signature électronique via le lien ${signatureProviderLink('yousign')} qui sera envoyé dès confirmation du paiement.`,
		});
	});

	it('docuseal redirect → e-mail + lien DocuSeal', () => {
		expect(
			resolveSignatureStepCopy({ provider: 'docuseal', mode: 'redirect', signKind: 'redirect' }),
		).toEqual({
			title: 'Vous signez le contrat de confidentialité par e-mail',
			text: `Signature électronique via le lien ${signatureProviderLink('docuseal')} qui sera envoyé dès confirmation du paiement.`,
		});
	});

	it('docuseal embed → signature sur la page', () => {
		expect(
			resolveSignatureStepCopy({ provider: 'docuseal', mode: 'embed', signKind: 'embed' }),
		).toEqual({
			title: 'Vous signez le contrat de confidentialité sur cette page',
			text: `Signature électronique intégrée via ${signatureProviderLink('docuseal')} dès confirmation du paiement.`,
		});
	});
});

describe('resolveSignatureConsentCopy', () => {
	it('embed → signature sur cette page', () => {
		expect(
			resolveSignatureConsentCopy({ provider: 'docuseal', mode: 'embed', signKind: 'embed' }),
		).toContain('sur cette page après paiement');
	});

	it('redirect → envoyé par e-mail', () => {
		expect(
			resolveSignatureConsentCopy({ provider: 'yousign', mode: 'redirect', signKind: 'redirect' }),
		).toContain('envoyé par e-mail après paiement');
	});
});

describe('resolveSignatureStatusCopy', () => {
	it('embed → contrat ci-dessous', () => {
		expect(
			resolveSignatureStatusCopy({ provider: 'docuseal', mode: 'embed', signKind: 'embed' }),
		).toEqual({
			signSurfaceReady: 'Votre contrat est prêt à signer ci-dessous.',
			signSurfaceWaiting:
				'Votre paiement est bien confirmé. Le contrat apparaît ici dès qu’il est prêt.',
			signSurfaceUnavailable:
				'Votre accord est prêt, mais le formulaire n’est pas encore disponible. Actualisez la page ou contactez un administrateur.',
		});
	});

	it('redirect → lien de signature', () => {
		expect(
			resolveSignatureStatusCopy({ provider: 'yousign', mode: 'redirect', signKind: 'redirect' }),
		).toEqual({
			signSurfaceReady: 'Le lien de signature est prêt.',
			signSurfaceWaiting:
				'Votre paiement est bien confirmé. Le lien de signature apparaît ici dès qu’il est prêt.',
			signSurfaceUnavailable:
				'Votre accord est prêt, mais le lien n’est pas encore disponible. Actualisez la page ou contactez un administrateur.',
		});
	});
});

describe('resolveSignatureCheckoutFlashCopy', () => {
	it('embed sent → ci-dessous', () => {
		expect(
			resolveSignatureCheckoutFlashCopy('sent', {
				provider: 'docuseal',
				mode: 'embed',
				signKind: 'embed',
			}),
		).toBe('Paiement reçu. Signez votre contrat de confidentialité ci-dessous pour continuer.');
	});

	it('redirect sent → sans ci-dessous', () => {
		expect(
			resolveSignatureCheckoutFlashCopy('sent', {
				provider: 'yousign',
				mode: 'redirect',
				signKind: 'redirect',
			}),
		).toBe('Paiement reçu. Signez votre contrat de confidentialité pour continuer.');
	});

	it('pending → préparation', () => {
		expect(
			resolveSignatureCheckoutFlashCopy('pending', {
				provider: 'docuseal',
				mode: 'embed',
				signKind: 'embed',
			}),
		).toBe('Paiement reçu. Nous préparons votre contrat de confidentialité.');
	});
});

describe('resolveSignatureMissingSignFaq', () => {
	it('embed → contrat à signer', () => {
		const faq = resolveSignatureMissingSignFaq('admin@test.com', {
			provider: 'docuseal',
			mode: 'embed',
			signKind: 'embed',
		});
		expect(faq.q).toBe('J’ai payé mais je ne vois pas le contrat à signer');
		expect(faq.a).toContain('Actualisez la page');
	});

	it('redirect → lien pour signer', () => {
		const faq = resolveSignatureMissingSignFaq('admin@test.com', {
			provider: 'yousign',
			mode: 'redirect',
			signKind: 'redirect',
		});
		expect(faq.q).toBe('J’ai payé mais je ne reçois pas de lien pour signer');
		expect(faq.a).toContain('spams');
	});
});

describe('resolveSignatureCgvEnrollmentStep', () => {
	it('embed → sur cette page', () => {
		expect(
			resolveSignatureCgvEnrollmentStep({
				provider: 'docuseal',
				mode: 'embed',
				signKind: 'embed',
			}),
		).toBe(
			'Signature électronique du contrat de confidentialité sur cette page (dès confirmation du paiement) ;',
		);
	});

	it('redirect → via provider par e-mail', () => {
		expect(
			resolveSignatureCgvEnrollmentStep({
				provider: 'yousign',
				mode: 'redirect',
				signKind: 'redirect',
			}),
		).toBe(
			'Signature électronique du contrat de confidentialité via YouSign (lien envoyé par e-mail) ;',
		);
	});
});

describe('resolveSignaturePrivacyDisclosure', () => {
	it('yousign', () => {
		expect(
			resolveSignaturePrivacyDisclosure({
				provider: 'yousign',
				mode: 'redirect',
				signKind: 'redirect',
			}),
		).toEqual({
			providerName: 'Yousign',
			privacyUrl: 'https://yousign.com/fr-fr/politique-de-confidentialite',
		});
	});

	it('docuseal', () => {
		expect(
			resolveSignaturePrivacyDisclosure({
				provider: 'docuseal',
				mode: 'embed',
				signKind: 'embed',
			}),
		).toEqual({
			providerName: 'DocuSeal',
			privacyUrl: 'https://www.docuseal.eu/privacy',
		});
	});
});
