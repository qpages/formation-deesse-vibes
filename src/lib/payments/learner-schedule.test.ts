import { describe, expect, it } from 'vitest';
import type { Enrollment, Payment } from '../../generated/prisma/client';
import { buildLearnerPaymentSchedule } from './learner-schedule';

function enrollment(overrides: Partial<Enrollment> = {}): Enrollment {
	return {
		id: 'enr_1',
		userId: 'usr_1',
		paymentPlan: 'x4',
		collectionStatus: 'current',
		contractStatus: 'signed',
		accessStatus: 'active',
		installmentsPaid: 1,
		installmentsTotal: 4,
		collectedAmountCents: 49_975,
		totalAmountCents: 199_900,
		nextInstallmentDueAt: new Date('2026-02-15T00:00:00.000Z'),
		currentPeriodEnd: new Date('2026-02-15T00:00:00.000Z'),
		subscriptionEndsAt: new Date('2026-05-15T00:00:00.000Z'),
		stripeScheduleEndBehavior: 'cancel',
		subscriptionStatus: 'active',
		stripeCustomerId: null,
		stripeSubscriptionId: null,
		stripeScheduleId: null,
		stripeCheckoutSessionId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	} as Enrollment;
}

function payment(overrides: Partial<Payment> = {}): Payment {
	return {
		id: 'pay_1',
		enrollmentId: 'enr_1',
		installmentNumber: 1,
		amountCents: 49_975,
		currency: 'eur',
		status: 'paid',
		failureReason: null,
		dueAt: null,
		paidAt: new Date('2026-01-15T00:00:00.000Z'),
		invoicedAt: null,
		stripeInvoiceId: 'in_1',
		stripePaymentIntentId: null,
		invoicePdfUrl: 'https://stripe.test/pdf',
		hostedInvoiceUrl: 'https://stripe.test/view',
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	} as Payment;
}

describe('buildLearnerPaymentSchedule', () => {
	it('expose le plan, le récap et les échéances projetées', () => {
		const schedule = buildLearnerPaymentSchedule(enrollment(), [payment()]);

		expect(schedule.planLabel).toBe('Paiement de 1 999,00 € en 4 mensualités de 499,75 €');
		expect(schedule.installments).toHaveLength(4);
		expect(schedule.installments[0]).toMatchObject({
			installmentNumber: 1,
			dateLabel: 'payé le 15/01/2026',
			amountLabel: '499,75€',
			viewUrl: 'https://stripe.test/view',
			downloadUrl: 'https://stripe.test/pdf',
			isEstimated: false,
		});
		expect(schedule.installments[1]).toMatchObject({
			installmentNumber: 2,
			dateLabel: 'prévu le 15/02/2026',
			isEstimated: true,
		});
		expect(schedule.installments[2]?.dateLabel).toBe('prévu le 15/03/2026');
	});

	it('retourne une liste vide sans paiement connu', () => {
		const schedule = buildLearnerPaymentSchedule(enrollment(), []);
		expect(schedule.installments).toEqual([]);
	});

	it('affiche Paiement unique pour le plan unique', () => {
		const schedule = buildLearnerPaymentSchedule(
			enrollment({
				paymentPlan: 'unique',
				installmentsPaid: 1,
				installmentsTotal: 1,
				collectedAmountCents: 184_900,
				totalAmountCents: 184_900,
			}),
			[
				payment({
					installmentNumber: 1,
					amountCents: 184_900,
				}),
			],
		);

		expect(schedule.planLabel).toBe('Paiement unique');
		expect(schedule.installments).toHaveLength(1);
	});
});
