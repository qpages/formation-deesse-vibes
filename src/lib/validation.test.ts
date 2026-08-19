import { describe, expect, it } from 'vitest';
import { checkoutSchema } from './validation';

const validCheckout = {
	firstName: 'Camille',
	lastName: 'Martin',
	email: 'camille@example.com',
	paymentPlan: 'unique' as const,
	consentCgv: true as const,
	consentNda: true as const,
	consentPrivacy: true as const,
	consentWithdrawalWaiver: true as const,
};

describe('checkoutSchema', () => {
	it('accepte tous les consentements requis', () => {
		expect(checkoutSchema.safeParse(validCheckout).success).toBe(true);
	});

	it('rejette consentWithdrawalWaiver absent', () => {
		const { consentWithdrawalWaiver: _, ...withoutWaiver } = validCheckout;
		expect(checkoutSchema.safeParse(withoutWaiver).success).toBe(false);
	});

	it('rejette consentWithdrawalWaiver false avec message rétractation', () => {
		const parsed = checkoutSchema.safeParse({
			...validCheckout,
			consentWithdrawalWaiver: false,
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toMatch(/rétractation/i);
		}
	});
});
