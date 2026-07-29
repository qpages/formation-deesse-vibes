import { describe, expect, it } from 'vitest';
import {
	adminPipelineBadges,
	checkoutSuccessFlash,
	mapYousignApiStatus,
	primaryAction,
	statusMessage,
	stepLabel,
	stepStates,
	yousignStatusFromEvent,
} from './status';

describe('stepStates', () => {
	it('marque le NDA en action requise quand envoyé', () => {
		expect(stepStates('nda_envoye')).toEqual({
			paiement: 'termine',
			nda: 'action_requise',
			acces: 'a_faire',
		});
	});

	it('termine tout après invitation', () => {
		expect(stepStates('teachizy_envoye')).toEqual({
			paiement: 'termine',
			nda: 'termine',
			acces: 'termine',
		});
	});
});

describe('primaryAction', () => {
	it('propose la signature quand le lien existe', () => {
		expect(primaryAction('nda_envoye', 'https://sign.example')).toEqual({
			kind: 'sign_nda',
			label: 'Signer mon accord',
			href: 'https://sign.example',
		});
	});

	it('propose la signature dès paiement confirmé si le lien est prêt', () => {
		expect(primaryAction('paiement_confirme', 'https://sign.example')).toEqual({
			kind: 'sign_nda',
			label: 'Signer mon accord',
			href: 'https://sign.example',
		});
	});

	it('propose Actualiser après signature NDA', () => {
		expect(primaryAction('nda_signe')).toEqual({
			kind: 'refresh',
			label: 'Actualiser',
		});
	});

	it('propose Actualiser si NDA envoyé sans lien', () => {
		expect(primaryAction('nda_envoye', null)).toEqual({
			kind: 'refresh',
			label: 'Actualiser',
		});
	});

	it('propose d’ouvrir la plateforme une fois l’invitation partie', () => {
		expect(primaryAction('teachizy_envoye')).toEqual({
			kind: 'open_platform',
			label: 'Entrer dans la formation',
			href: 'https://jsmatriceacademy.teachizy.fr',
		});
	});

	it('propose le checkout avant paiement', () => {
		expect(primaryAction('paiement_en_attente').kind).toBe('checkout');
	});
});

describe('checkoutSuccessFlash', () => {
	it('reste utile tôt dans le parcours', () => {
		expect(checkoutSuccessFlash('paiement_confirme')).toContain('Paiement reçu');
		expect(checkoutSuccessFlash('nda_envoye')).toContain('Signez');
	});

	it('laisse le panneau parler une fois le NDA signé', () => {
		expect(checkoutSuccessFlash('nda_signe')).toBeNull();
		expect(checkoutSuccessFlash('teachizy_envoye')).toBeNull();
	});
});

describe('statusMessage', () => {
	it('décrit l’attente Teachizy après signature', () => {
		expect(statusMessage('nda_signe')).toContain('contrat de confidentialité signé');
	});

	it('rappelle l’email Teachizy une fois invité', () => {
		expect(statusMessage('teachizy_envoye')).toContain(
			'Un email Teachizy avec vos identifiants vous a été envoyé.',
		);
		expect(statusMessage('teachizy_envoye')).toContain('Mot de passe oublié');
	});
});

describe('stepLabel', () => {
	it('libelle explicite', () => {
		expect(stepLabel('action_requise')).toBe('Action requise');
	});
});

describe('adminPipelineBadges', () => {
	it('sépare paiement et signature', () => {
		const badges = adminPipelineBadges({
			status: 'nda_envoye',
			yousignStatus: 'ongoing',
		});
		expect(badges.paiement.label).toBe('Terminé');
		expect(badges.signature.label).toBe('En attente');
		expect(badges.acces.label).toBe('À faire');
	});

	it('surfacé un NDA expiré', () => {
		const badges = adminPipelineBadges({
			status: 'nda_envoye',
			yousignStatus: 'expired',
		});
		expect(badges.signature).toEqual({ label: 'Expiré', tone: 'action' });
	});
});

describe('yousignStatusFromEvent', () => {
	it('mappe expired', () => {
		expect(yousignStatusFromEvent('signature_request.expired')).toBe('expired');
	});

	it('mappe notification delivery failed vers error', () => {
		expect(yousignStatusFromEvent('signer.notification_delivery_failed')).toBe('error');
	});

	it('mappe deleted vers canceled', () => {
		expect(yousignStatusFromEvent('signature_request.deleted')).toBe('canceled');
	});
});

describe('mapYousignApiStatus', () => {
	it('mappe les statuts API courants', () => {
		expect(mapYousignApiStatus('ongoing')).toBe('ongoing');
		expect(mapYousignApiStatus('done')).toBe('done');
		expect(mapYousignApiStatus('expired')).toBe('expired');
		expect(mapYousignApiStatus('declined')).toBe('declined');
		expect(mapYousignApiStatus('canceled')).toBe('canceled');
		expect(mapYousignApiStatus('rejected')).toBe('rejected');
	});

	it('ramène draft / approval / paused vers ongoing', () => {
		expect(mapYousignApiStatus('draft')).toBe('ongoing');
		expect(mapYousignApiStatus('approval')).toBe('ongoing');
		expect(mapYousignApiStatus('paused')).toBe('ongoing');
	});

	it('mappe deleted vers canceled', () => {
		expect(mapYousignApiStatus('deleted')).toBe('canceled');
	});

	it('retourne null pour un statut inconnu', () => {
		expect(mapYousignApiStatus('weird')).toBeNull();
	});
});
