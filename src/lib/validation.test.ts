import { describe, expect, it } from 'vitest';
import {
	checkoutSchema,
	magicLinkSchema,
	parseAdminListQuery,
} from './validation';

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

describe('parseAdminListQuery', () => {
	it('applique les défauts', () => {
		expect(parseAdminListQuery(new URLSearchParams())).toEqual({ q: '', page: 1 });
	});

	it('parse q et page', () => {
		expect(parseAdminListQuery(new URLSearchParams('q=marie&page=3'))).toEqual({
			q: 'marie',
			page: 3,
		});
	});

	it('ignore une page invalide sans perdre q', () => {
		expect(parseAdminListQuery(new URLSearchParams('q=marie&page=abc'))).toEqual({
			q: 'marie',
			page: 1,
		});
	});
});
