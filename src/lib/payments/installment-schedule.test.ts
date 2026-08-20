import { describe, expect, it } from 'vitest';
import {
	computeInstallmentProjection,
	expandInstallmentRows,
} from './installment-schedule';

describe('computeInstallmentProjection', () => {
	it('projette les dates des échéances futures', () => {
		const projection = computeInstallmentProjection({
			installmentsPaid: 1,
			installmentsTotal: 4,
			totalAmountCents: 199_900,
			collectedAmountCents: 49_975,
			nextInstallmentDueAt: new Date('2026-02-15T00:00:00.000Z'),
			currentPeriodEnd: new Date('2026-02-15T00:00:00.000Z'),
			existingPaymentCount: 1,
		});

		expect(projection.total).toBe(4);
		expect(projection.estimatedCents).toBe(49_975);
		expect(projection.projectedDueDates.get(2)?.toISOString()).toBe('2026-02-15T00:00:00.000Z');
		expect(projection.projectedDueDates.get(3)?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
	});
});

describe('expandInstallmentRows', () => {
	it('complète avec des lignes estimées', () => {
		const projection = computeInstallmentProjection({
			installmentsPaid: 1,
			installmentsTotal: 4,
			totalAmountCents: 199_900,
			collectedAmountCents: 49_975,
			nextInstallmentDueAt: new Date('2026-02-15T00:00:00.000Z'),
			currentPeriodEnd: new Date('2026-02-15T00:00:00.000Z'),
			existingPaymentCount: 1,
		});

		const rows = expandInstallmentRows({
			payments: [{ installmentNumber: 1, amountCents: 49_975, dueAt: null }],
			projection,
			createEstimated: (installmentNumber, estimatedCents, dueAt) => ({
				installmentNumber,
				amountCents: estimatedCents,
				dueAt,
			}),
		});

		expect(rows).toHaveLength(4);
		expect(rows[0]?.isEstimated).toBe(false);
		expect(rows[1]?.isEstimated).toBe(true);
		expect(rows[1]?.dueAt?.toISOString()).toBe('2026-02-15T00:00:00.000Z');
	});

	it('retourne [] sans paiement connu', () => {
		const projection = computeInstallmentProjection({
			installmentsPaid: 0,
			installmentsTotal: 4,
			totalAmountCents: 199_900,
			collectedAmountCents: 0,
			nextInstallmentDueAt: null,
			currentPeriodEnd: null,
			existingPaymentCount: 0,
		});

		expect(
			expandInstallmentRows({
				payments: [],
				projection,
				createEstimated: (installmentNumber, estimatedCents, dueAt) => ({
					installmentNumber,
					amountCents: estimatedCents,
					dueAt,
				}),
			}),
		).toEqual([]);
	});
});
