import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { assertCheckoutAmountAcceptable, isCheckoutPaid } from './payment';

function session(partial: Partial<Stripe.Checkout.Session>): Stripe.Checkout.Session {
	return partial as Stripe.Checkout.Session;
}

describe('assertCheckoutAmountAcceptable', () => {
	it('accepte le prix catalogue', () => {
		expect(() =>
			assertCheckoutAmountAcceptable(session({ amount_total: 32_000 })),
		).not.toThrow();
	});

	it('accepte un montant réduit (code promo)', () => {
		expect(() =>
			assertCheckoutAmountAcceptable(session({ amount_total: 25_000 })),
		).not.toThrow();
	});

	it('refuse un montant supérieur au catalogue', () => {
		expect(() =>
			assertCheckoutAmountAcceptable(session({ amount_total: 40_000 })),
		).toThrow(/incorrect/);
	});
});

describe('isCheckoutPaid', () => {
	it('détecte paid et no_payment_required', () => {
		expect(isCheckoutPaid(session({ payment_status: 'paid' }))).toBe(true);
		expect(isCheckoutPaid(session({ payment_status: 'no_payment_required' }))).toBe(
			true,
		);
		expect(isCheckoutPaid(session({ payment_status: 'unpaid' }))).toBe(false);
	});
});
