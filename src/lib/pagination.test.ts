import { describe, expect, it } from 'vitest';
import { paginate } from './pagination';

describe('paginate', () => {
	it('calcule skip/take et bornes d’affichage', () => {
		expect(paginate({ total: 100, page: 2, pageSize: 25 })).toMatchObject({
			page: 2,
			totalPages: 4,
			skip: 25,
			take: 25,
			from: 26,
			to: 50,
			hasPrev: true,
			hasNext: true,
		});
	});

	it('clamp la page hors bornes', () => {
		expect(paginate({ total: 10, page: 99, pageSize: 25 }).page).toBe(1);
		expect(paginate({ total: 100, page: 0, pageSize: 25 }).page).toBe(1);
	});

	it('gère une liste vide', () => {
		expect(paginate({ total: 0, page: 1, pageSize: 25 })).toMatchObject({
			total: 0,
			totalPages: 1,
			from: 0,
			to: 0,
			hasPrev: false,
			hasNext: false,
		});
	});
});
