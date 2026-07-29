import { describe, expect, it } from 'vitest';
import { adminListHref, enrollmentSearchWhere } from './enrollments';

describe('enrollmentSearchWhere', () => {
	it('retourne undefined pour une recherche vide', () => {
		expect(enrollmentSearchWhere('')).toBeUndefined();
		expect(enrollmentSearchWhere('   ')).toBeUndefined();
	});

	it('tokenise la recherche (prénom + nom)', () => {
		const where = enrollmentSearchWhere('Marie Dupont');
		expect(where).toEqual({
			AND: [
				{
					OR: [
						{ email: { contains: 'Marie', mode: 'insensitive' } },
						{ firstName: { contains: 'Marie', mode: 'insensitive' } },
						{ lastName: { contains: 'Marie', mode: 'insensitive' } },
					],
				},
				{
					OR: [
						{ email: { contains: 'Dupont', mode: 'insensitive' } },
						{ firstName: { contains: 'Dupont', mode: 'insensitive' } },
						{ lastName: { contains: 'Dupont', mode: 'insensitive' } },
					],
				},
			],
		});
	});

	it('limite à 5 tokens', () => {
		const where = enrollmentSearchWhere('a b c d e f g');
		expect(where?.AND).toHaveLength(5);
	});
});

describe('adminListHref', () => {
	it('omet les params par défaut', () => {
		expect(adminListHref({})).toBe('/admin');
		expect(adminListHref({ q: '', page: 1 })).toBe('/admin');
	});

	it('préserve q et page', () => {
		expect(adminListHref({ q: 'marie', page: 2 })).toBe('/admin?q=marie&page=2');
		expect(adminListHref({ q: 'marie' })).toBe('/admin?q=marie');
	});
});
