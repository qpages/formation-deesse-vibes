import { describe, expect, test } from 'vitest';
import { paidInvoiceLabel } from './payment-plans';

describe('paidInvoiceLabel', () => {
	test('montant + date de paiement', () => {
		const label = paidInvoiceLabel(149000, new Date('2026-08-15T12:00:00+02:00'));
		expect(label).toContain('1 490,00');
		expect(label).toContain('payé le 15/08/2026');
	});

	test('sans date : montant seul', () => {
		expect(paidInvoiceLabel(5000, null)).toContain('50,00');
		expect(paidInvoiceLabel(5000, null)).not.toContain('payé le');
	});
});
