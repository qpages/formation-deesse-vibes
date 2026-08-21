import { describe, expect, test } from 'vitest';
import {
	installmentCheckoutMessage,
	installmentPlanSummary,
	paidInvoiceLabel,
	PAYMENT_PLANS,
} from './payment-plans';

describe('installmentPlanSummary', () => {
	test('plan échelonné avec montant total', () => {
		expect(installmentPlanSummary(PAYMENT_PLANS.x4)).toBe(
			'Paiement de 1 999,00 € en 4 mensualités de 499,75 €',
		);
	});

	test('paiement unique', () => {
		expect(installmentPlanSummary(PAYMENT_PLANS.unique)).toBe('Paiement unique');
	});
});

describe('installmentCheckoutMessage', () => {
	test('inclut le total, le nombre de fois et l’arrêt automatique', () => {
		expect(installmentCheckoutMessage(PAYMENT_PLANS.x4)).toBe(
			"Paiement de 1 999,00 € en 4 mensualités de 499,75 €. Arrêt automatique de l'abonnement à l'issue de la dernière échéance.",
		);
	});
});

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
