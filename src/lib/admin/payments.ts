import type { Enrollment, Payment } from '../../generated/prisma/client';
import { getPrisma } from '../prisma';
import { formatMoney } from '../payment-plans';
import { findEnrollmentById } from '../enrollment';
import {
	paymentPlanLabel,
	paymentProgressLabel,
	paymentSummaryLine,
	paymentTrackingLabel,
	paymentTrackingState,
	paymentTrackingTone,
	PAYMENT_STATUS_LABELS,
	type PaymentTrackingState,
} from '../status';
import { hydrateInvoiceUrls } from '../payments';
import { stripeDashboardUrl } from '../stripe';

export type AdminPaymentRow = {
	id: string;
	installmentNumber: number;
	amountLabel: string;
	status: Payment['status'];
	statusLabel: string;
	failureReason: string | null;
	dueAt: string | null;
	paidAt: string | null;
	stripeUrl: string | null;
	stripeInvoiceId: string | null;
	stripePaymentIntentId: string | null;
	invoicePdfUrl: string | null;
	hostedInvoiceUrl: string | null;
};

export type AdminInvoiceLink = {
	installmentNumber: number;
	amountLabel: string;
	paidAt: string | null;
	pdfUrl: string | null;
	hostedUrl: string | null;
};

export type AdminPaymentSummary = {
	planLabel: string;
	progressLabel: string;
	summaryLine: string;
	trackingState: PaymentTrackingState;
	trackingLabel: string;
	trackingTone: ReturnType<typeof paymentTrackingTone>;
	nextInstallmentDueAt: string | null;
	subscriptionStatus: Enrollment['subscriptionStatus'];
	collectedAmountCents: number;
	totalAmountCents: number | null;
	installmentsPaid: number;
	installmentsTotal: number | null;
	stripeSubscriptionUrl: string | null;
	stripeScheduleUrl: string | null;
	stripeCheckoutSessionId: string | null;
	stripeCheckoutUrl: string | null;
	invoices: AdminInvoiceLink[];
	payments: AdminPaymentRow[];
};

export function buildAdminPaymentSummary(
	enrollment: Enrollment,
	payments: Payment[],
): AdminPaymentSummary {
	const trackingState = paymentTrackingState({
		collectionStatus: enrollment.collectionStatus,
		installmentsPaid: enrollment.installmentsPaid,
		installmentsTotal: enrollment.installmentsTotal,
		payments,
	});

	const paymentRows: AdminPaymentRow[] = payments.map((payment) => ({
		id: payment.id,
		installmentNumber: payment.installmentNumber,
		amountLabel: formatMoney(payment.amountCents, payment.currency),
		status: payment.status,
		statusLabel: PAYMENT_STATUS_LABELS[payment.status],
		failureReason: payment.failureReason,
		dueAt: payment.dueAt?.toISOString() ?? null,
		paidAt: payment.paidAt?.toISOString() ?? null,
		stripeUrl: stripeDashboardUrl({
			invoiceId: payment.stripeInvoiceId,
			paymentIntentId: payment.stripePaymentIntentId,
		}),
		stripeInvoiceId: payment.stripeInvoiceId,
		stripePaymentIntentId: payment.stripePaymentIntentId,
		invoicePdfUrl: payment.invoicePdfUrl,
		hostedInvoiceUrl: payment.hostedInvoiceUrl,
	}));

	return {
		planLabel: paymentPlanLabel(enrollment.paymentPlan),
		progressLabel: paymentProgressLabel({
			installmentsPaid: enrollment.installmentsPaid,
			installmentsTotal: enrollment.installmentsTotal,
		}),
		summaryLine: paymentSummaryLine({
			installmentsPaid: enrollment.installmentsPaid,
			installmentsTotal: enrollment.installmentsTotal,
			collectedAmountCents: enrollment.collectedAmountCents,
			totalAmountCents: enrollment.totalAmountCents,
		}),
		trackingState,
		trackingLabel: paymentTrackingLabel(trackingState),
		trackingTone: paymentTrackingTone(trackingState),
		nextInstallmentDueAt: enrollment.nextInstallmentDueAt?.toISOString() ?? null,
		subscriptionStatus: enrollment.subscriptionStatus,
		collectedAmountCents: enrollment.collectedAmountCents,
		totalAmountCents: enrollment.totalAmountCents,
		installmentsPaid: enrollment.installmentsPaid,
		installmentsTotal: enrollment.installmentsTotal,
		stripeSubscriptionUrl: stripeDashboardUrl({
			subscriptionId: enrollment.stripeSubscriptionId,
		}),
		stripeScheduleUrl: stripeDashboardUrl({ scheduleId: enrollment.stripeScheduleId }),
		stripeCheckoutSessionId: enrollment.stripeCheckoutSessionId,
		stripeCheckoutUrl: stripeDashboardUrl({
			checkoutSessionId: enrollment.stripeCheckoutSessionId,
		}),
		invoices: paymentRows
			.filter((payment) => payment.invoicePdfUrl || payment.hostedInvoiceUrl)
			.map((payment) => ({
				installmentNumber: payment.installmentNumber,
				amountLabel: payment.amountLabel,
				paidAt: payment.paidAt,
				pdfUrl: payment.invoicePdfUrl,
				hostedUrl: payment.hostedInvoiceUrl,
			})),
		payments: paymentRows,
	};
}

/** Detail / dialog path only — may write invoice URLs from Stripe. */
export async function getAdminPaymentSummary(enrollmentId: string) {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) return null;

	const payments = await getPrisma().payment.findMany({
		where: { enrollmentId },
		orderBy: { installmentNumber: 'asc' },
	});

	const hydrated = await hydrateInvoiceUrls(payments);
	return buildAdminPaymentSummary(enrollment, hydrated);
}

/**
 * Expand known payments with estimated future installments for admin UI.
 * No synthetic rows until Stripe has produced at least one payment record.
 */
export function expandAdminInstallments(summary: AdminPaymentSummary): AdminPaymentRow[] {
	if (summary.payments.length === 0) return [];

	const total = summary.installmentsTotal ?? Math.max(summary.payments.length, 1);
	const byNumber = new Map(summary.payments.map((p) => [p.installmentNumber, p]));
	const remainingCents = Math.max(
		0,
		(summary.totalAmountCents ?? summary.collectedAmountCents) - summary.collectedAmountCents,
	);
	const remainingSlots = Math.max(0, total - summary.installmentsPaid);
	const estimatedCents = remainingSlots > 0 ? Math.round(remainingCents / remainingSlots) : 0;

	const rows: AdminPaymentRow[] = [];
	let assignedNextDue = false;

	for (let n = 1; n <= total; n++) {
		const existing = byNumber.get(n);
		if (existing) {
			rows.push(existing);
			if (existing.status !== 'paid' && existing.dueAt) assignedNextDue = true;
			continue;
		}

		const dueAt =
			!assignedNextDue && summary.nextInstallmentDueAt ? summary.nextInstallmentDueAt : null;
		if (dueAt) assignedNextDue = true;

		rows.push({
			id: `estimated-${n}`,
			installmentNumber: n,
			amountLabel: formatMoney(estimatedCents),
			status: 'open',
			statusLabel: 'À venir',
			failureReason: null,
			dueAt,
			paidAt: null,
			stripeUrl: null,
			stripeInvoiceId: null,
			stripePaymentIntentId: null,
			invoicePdfUrl: null,
			hostedInvoiceUrl: null,
		});
	}

	return rows;
}

export { listPaidInvoiceLinks } from '../payments';

export async function listPaymentsForEnrollments(enrollmentIds: string[]) {
	if (enrollmentIds.length === 0) return new Map<string, Payment[]>();

	const prisma = getPrisma();
	const payments = await prisma.payment.findMany({
		where: { enrollmentId: { in: enrollmentIds } },
		orderBy: { installmentNumber: 'asc' },
	});

	const map = new Map<string, Payment[]>();
	for (const payment of payments) {
		const list = map.get(payment.enrollmentId) ?? [];
		list.push(payment);
		map.set(payment.enrollmentId, list);
	}
	return map;
}
