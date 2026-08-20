import { describe, expect, it } from 'vitest';
import { stripeId } from './stripe-id';

describe('stripeId', () => {
	it('retourne undefined pour valeurs vides', () => {
		expect(stripeId(null)).toBeUndefined();
		expect(stripeId(undefined)).toBeUndefined();
		expect(stripeId('')).toBeUndefined();
	});

	it('retourne la string telle quelle', () => {
		expect(stripeId('sub_123')).toBe('sub_123');
	});

	it('extrait id depuis un objet Stripe', () => {
		expect(stripeId({ id: 'pi_456' })).toBe('pi_456');
	});

	it('ignore les objets sans id string', () => {
		expect(stripeId({ id: 1 })).toBeUndefined();
		expect(stripeId({ foo: 'bar' })).toBeUndefined();
	});
});
