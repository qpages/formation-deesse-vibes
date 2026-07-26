import { describe, expect, it } from 'vitest';
import { primaryAction, stepLabel, stepStates } from './status';

describe('stepStates', () => {
	it('marque le NDA en action requise quand envoyé', () => {
		expect(stepStates('nda_envoye')).toEqual({
			paiement: 'termine',
			nda: 'action_requise',
			acces: 'a_faire',
		});
	});

	it('termine tout après invitation', () => {
		expect(stepStates('invitation_envoyee')).toEqual({
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

	it('propose le checkout avant paiement', () => {
		expect(primaryAction('paiement_en_attente').kind).toBe('checkout');
	});
});

describe('stepLabel', () => {
	it('libelle explicite', () => {
		expect(stepLabel('action_requise')).toBe('Action requise');
	});
});
