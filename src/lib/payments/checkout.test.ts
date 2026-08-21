import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
	assertCheckoutAmountAcceptable,
	CheckoutAlreadyPaidError,
	isCheckoutPaid,
} from './checkout';

function session(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
	return {
		object: 'checkout.session',
		id: 'cs_test',
		payment_status: 'paid',
		amount_total: 10000,
		...overrides,
	} as Stripe.Checkout.Session;
}

describe('CheckoutAlreadyPaidError', () => {
	it('a le bon name et message', () => {
		const error = new CheckoutAlreadyPaidError();
		expect(error.name).toBe('CheckoutAlreadyPaidError');
		expect(error.message).toBe('Checkout déjà payé');
	});
});

describe('isCheckoutPaid', () => {
	it('true pour paid et no_payment_required', () => {
		expect(isCheckoutPaid(session({ payment_status: 'paid' }))).toBe(true);
		expect(isCheckoutPaid(session({ payment_status: 'no_payment_required' }))).toBe(true);
	});

	it('false pour unpaid', () => {
		expect(isCheckoutPaid(session({ payment_status: 'unpaid' }))).toBe(false);
	});
});

describe('assertCheckoutAmountAcceptable', () => {
	it('accepte un montant dans la borne', () => {
		expect(() =>
			assertCheckoutAmountAcceptable(session({ amount_total: 5000 }), 10000),
		).not.toThrow();
	});

	it('accepte un montant égal au max (promo)', () => {
		expect(() =>
			assertCheckoutAmountAcceptable(session({ amount_total: 10000 }), 10000),
		).not.toThrow();
	});

	it('throw si amount_total manquant', () => {
		expect(() => assertCheckoutAmountAcceptable(session({ amount_total: null }), 10000)).toThrow(
			'Checkout sans amount_total',
		);
	});

	it('throw si montant négatif ou au-dessus du max', () => {
		expect(() => assertCheckoutAmountAcceptable(session({ amount_total: -1 }), 10000)).toThrow(
			'Montant Checkout incorrect',
		);
		expect(() => assertCheckoutAmountAcceptable(session({ amount_total: 10001 }), 10000)).toThrow(
			'Montant Checkout incorrect',
		);
	});
});
