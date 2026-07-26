import { describe, expect, it } from 'vitest';
import { checkoutSchema, magicLinkSchema } from './validation';

describe('checkoutSchema', () => {
	it('accepte un payload valide', () => {
		const parsed = checkoutSchema.safeParse({
			firstName: 'Marie',
			lastName: 'Dupont',
			email: 'marie@example.com',
			consentCgv: true,
			consentNda: true,
			consentPrivacy: true,
		});
		expect(parsed.success).toBe(true);
	});

	it('refuse sans consentements', () => {
		const parsed = checkoutSchema.safeParse({
			firstName: 'Marie',
			lastName: 'Dupont',
			email: 'marie@example.com',
			consentCgv: false,
			consentNda: true,
			consentPrivacy: true,
		});
		expect(parsed.success).toBe(false);
	});
});

describe('magicLinkSchema', () => {
	it('valide un e-mail', () => {
		expect(magicLinkSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
		expect(magicLinkSchema.safeParse({ email: 'nope' }).success).toBe(false);
	});
});
