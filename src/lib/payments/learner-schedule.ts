import type { Enrollment, Payment, PaymentStatus } from '../../generated/prisma/client';
import { findEnrollmentById } from '../enrollment';
import {
	formatMoney,
	installmentPlanSummary,
	PAYMENT_PLANS,
	type PaymentPlanId,
} from '../payment-plans';
import { getPrisma } from '../prisma';
import { hydrateInvoiceUrls } from './invoice-links';
import { computeInstallmentProjection, expandInstallmentRows } from './installment-schedule';

export type LearnerInstallment = {
	installmentNumber: number;
	amountLabel: string;
	dateLabel: string;
	isEstimated: boolean;
	viewUrl: string | null;
	downloadUrl: string | null;
};

export type LearnerPaymentSchedule = {
	planLabel: string;
	installments: LearnerInstallment[];
};

type SchedulePayment = Pick<
	Payment,
	| 'installmentNumber'
	| 'amountCents'
	| 'currency'
	| 'status'
	| 'paidAt'
	| 'dueAt'
	| 'hostedInvoiceUrl'
	| 'invoicePdfUrl'
>;

function formatFrDate(date: Date): string {
	return date.toLocaleDateString('fr-FR');
}

function formatLearnerAmount(cents: number, currency: string): string {
	return formatMoney(cents, currency).replace(/\s+€/, '€');
}

function learnerPlanLabel(plan: PaymentPlanId | null | undefined): string {
	if (!plan) return '—';
	const config = PAYMENT_PLANS[plan];
	if (!config) return plan;
	return installmentPlanSummary(config);
}

function installmentDateLabel(input: {
	status: PaymentStatus;
	paidAt: Date | null;
	dueAt: Date | null;
	projectedDueAt: Date | null;
	isEstimated: boolean;
}): string {
	if (input.status === 'paid') {
		const date = input.paidAt ?? input.dueAt;
		return date ? `payé le ${formatFrDate(date)}` : 'payé';
	}

	if (input.status === 'failed' || input.status === 'uncollectible') {
		return input.dueAt ? `échéance ${formatFrDate(input.dueAt)}` : 'impayé';
	}

	const due = input.dueAt ?? input.projectedDueAt;
	if (!due) return 'date à venir';
	if (input.isEstimated) return `prévu le ${formatFrDate(due)}`;
	return `échéance ${formatFrDate(due)}`;
}

export function buildLearnerPaymentSchedule(
	enrollment: Enrollment,
	payments: SchedulePayment[],
): LearnerPaymentSchedule {
	const projection = computeInstallmentProjection({
		installmentsPaid: enrollment.installmentsPaid,
		installmentsTotal: enrollment.installmentsTotal,
		totalAmountCents: enrollment.totalAmountCents,
		collectedAmountCents: enrollment.collectedAmountCents,
		nextInstallmentDueAt: enrollment.nextInstallmentDueAt,
		currentPeriodEnd: enrollment.currentPeriodEnd,
		existingPaymentCount: payments.length,
	});

	const rows = expandInstallmentRows({
		payments,
		projection,
		createEstimated: (installmentNumber, estimatedCents, dueAt) => ({
			installmentNumber,
			amountCents: estimatedCents,
			currency: 'eur',
			status: 'open' as const,
			paidAt: null,
			dueAt: dueAt,
			hostedInvoiceUrl: null,
			invoicePdfUrl: null,
		}),
	});

	const installments = rows.map((row) => ({
		installmentNumber: row.installmentNumber,
		amountLabel: formatLearnerAmount(row.amountCents, row.currency),
		dateLabel: installmentDateLabel({
			status: row.status,
			paidAt: row.paidAt,
			dueAt: row.dueAt,
			projectedDueAt: row.isEstimated ? row.dueAt : null,
			isEstimated: row.isEstimated,
		}),
		isEstimated: row.isEstimated,
		viewUrl: row.hostedInvoiceUrl,
		downloadUrl: row.invoicePdfUrl,
	}));

	return {
		planLabel: learnerPlanLabel(enrollment.paymentPlan),
		installments,
	};
}

export async function getLearnerPaymentSchedule(
	enrollmentId: string,
): Promise<LearnerPaymentSchedule | null> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) return null;

	const payments = await getPrisma().payment.findMany({
		where: { enrollmentId },
		orderBy: { installmentNumber: 'asc' },
	});

	const hydrated = await hydrateInvoiceUrls(payments);
	return buildLearnerPaymentSchedule(enrollment, hydrated);
}
