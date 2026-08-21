import { describe, expect, it } from 'vitest';
import { expandAdminInstallments, type AdminPaymentSummary } from './payments';

function summary(overrides: Partial<AdminPaymentSummary> = {}): AdminPaymentSummary {
	return {
		planLabel: '4 échéances',
		progressLabel: '1/4',
		summaryLine: '1/4',
		trackingState: 'a_jour',
		trackingLabel: 'À jour',
		trackingTone: 'success',
		nextInstallmentDueAt: '2026-02-15T00:00:00.000Z',
		currentPeriodEnd: '2026-02-15T00:00:00.000Z',
		subscriptionEndsAt: '2026-05-15T00:00:00.000Z',
		stripeScheduleEndBehavior: 'cancel',
		subscriptionStatus: 'active',
		collectedAmountCents: 49_975,
		totalAmountCents: 199_900,
		installmentsPaid: 1,
		installmentsTotal: 4,
		stripeSubscriptionUrl: null,
		stripeScheduleUrl: null,
		stripeCheckoutSessionId: null,
		stripeCheckoutUrl: null,
		invoices: [],
		payments: [
			{
				id: 'pay_1',
				installmentNumber: 1,
				amountLabel: '499,75 €',
				status: 'paid',
				statusLabel: 'Payé',
				failureReason: null,
				dueAt: null,
				paidAt: '2026-01-15T00:00:00.000Z',
				stripeUrl: null,
				stripeInvoiceId: 'in_1',
				stripePaymentIntentId: null,
				invoicePdfUrl: null,
				hostedInvoiceUrl: null,
			},
		],
		...overrides,
	};
}

describe('expandAdminInstallments', () => {
	it('projette les dates des échéances estimées', () => {
		const rows = expandAdminInstallments(summary());

		expect(rows).toHaveLength(4);
		expect(rows[1]?.dueAt).toBe('2026-02-15T00:00:00.000Z');
		expect(rows[2]?.dueAt).toBe('2026-03-15T00:00:00.000Z');
		expect(rows[3]?.dueAt).toBe('2026-04-15T00:00:00.000Z');
		expect(rows[1]?.id).toBe('estimated-2');
	});

	it('retourne [] sans paiement connu', () => {
		expect(expandAdminInstallments(summary({ payments: [] }))).toEqual([]);
	});
});
