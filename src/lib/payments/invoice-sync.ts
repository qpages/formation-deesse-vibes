import type Stripe from 'stripe';
import type { CollectionStatus, PaymentStatus } from '../../generated/prisma/client';
import { getPrisma } from '../prisma';
import { hasOpenOrFailedPayments } from '../enrollment-gates';
import { applyAccessPolicy } from '../enrollment/access';
import {
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	findEnrollmentBySubscriptionId,
	findEnrollmentIdByPaymentIntentId,
	type EnrollmentWithUser,
} from '../enrollment';
import {
	listSubscriptionInvoices,
	paymentIntentIdFromInvoice,
	retrieveInvoice,
} from '../stripe';
import {
	notifyCollectionStatusChange,
	notifyInstallmentPaid,
} from './notifications';
import { stripeId } from './stripe-id';

/** Stripe SDK typings omit some Invoice fields depending on API version. */
type InvoiceExtras = Stripe.Invoice & {
	payment_intent?: string | { id: string } | null;
	subscription?: string | { id: string } | null;
	subscription_details?: { metadata?: Stripe.Metadata | null } | null;
};

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
	return stripeId((invoice as InvoiceExtras).subscription);
}

function mapInvoiceStatus(status: Stripe.Invoice.Status | null): PaymentStatus {
	switch (status) {
		case 'paid':
			return 'paid';
		case 'open':
			return 'open';
		case 'uncollectible':
			return 'uncollectible';
		case 'void':
			return 'void';
		case 'draft':
			return 'draft';
		default:
			return 'open';
	}
}

async function resolveInstallmentNumber(
	enrollmentId: string,
	invoice: Stripe.Invoice,
): Promise<number> {
	const prisma = getPrisma();
	const existing = invoice.id
		? await prisma.payment.findUnique({ where: { stripeInvoiceId: invoice.id } })
		: null;
	if (existing) return existing.installmentNumber;

	const paymentIntentId = paymentIntentIdFromInvoice(invoice);
	if (paymentIntentId) {
		const byPi = await prisma.payment.findFirst({
			where: { enrollmentId, stripePaymentIntentId: paymentIntentId },
		});
		if (byPi) return byPi.installmentNumber;
	}

	const subscriptionId = subscriptionIdFromInvoice(invoice);

	if (subscriptionId) {
		const invoices = await listSubscriptionInvoices(subscriptionId);
		const sorted = invoices.data
			.filter((row) => row.id)
			.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
		const index = sorted.findIndex((row) => row.id === invoice.id);
		if (index >= 0) return index + 1;
	} else {
		const orphan = await prisma.payment.findFirst({
			where: { enrollmentId, stripeInvoiceId: null },
			orderBy: { installmentNumber: 'asc' },
		});
		if (orphan) return orphan.installmentNumber;
	}

	const count = await prisma.payment.count({ where: { enrollmentId } });
	return count + 1;
}

/**
 * Recalcule agrégats Payment + collectionStatus (source de vérité = lignes Payment).
 * Règles : refunded/canceled explicites → past_due si failed/open → paid → current → pending.
 */
export async function recomputeEnrollmentCollectionState(enrollmentId: string) {
	const prisma = getPrisma();
	const enrollment = await findEnrollmentByIdOrThrow(enrollmentId);
	const payments = await prisma.payment.findMany({
		where: { enrollmentId },
		orderBy: { installmentNumber: 'asc' },
	});

	const paid = payments.filter((p) => p.status === 'paid');
	const failedOrOpen = payments.filter((p) => p.status === 'open' || p.status === 'failed');
	const collectedAmountCents = paid.reduce((sum, p) => sum + p.amountCents, 0);
	const installmentsPaid = paid.length;
	const installmentsTotal = enrollment.installmentsTotal ?? 1;

	const nextDue = failedOrOpen
		.map((p) => p.dueAt)
		.filter(Boolean)
		.sort((a, b) => a!.getTime() - b!.getTime())[0];

	const firstPaidAt =
		paid
			.map((p) => p.paidAt)
			.filter(Boolean)
			.sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;

	const previous = enrollment.collectionStatus;
	let collectionStatus: CollectionStatus;
	if (previous === 'refunded' || previous === 'canceled') {
		collectionStatus = previous;
	} else if (hasOpenOrFailedPayments(payments) && installmentsPaid >= 1) {
		collectionStatus = 'past_due';
	} else if (failedOrOpen.some((p) => p.status === 'failed')) {
		collectionStatus = 'past_due';
	} else if (installmentsPaid >= installmentsTotal && installmentsPaid > 0) {
		collectionStatus = 'paid';
	} else if (installmentsPaid >= 1) {
		collectionStatus = 'current';
	} else {
		collectionStatus = 'pending';
	}

	const fullyPaidAt =
		collectionStatus === 'paid'
			? (enrollment.fullyPaidAt ??
				paid
					.map((p) => p.paidAt)
					.filter(Boolean)
					.sort((a, b) => b!.getTime() - a!.getTime())[0] ??
				new Date())
			: null;

	await prisma.enrollment.update({
		where: { id: enrollmentId },
		data: {
			installmentsPaid,
			collectedAmountCents,
			nextInstallmentDueAt: nextDue ?? null,
			collectionStatus,
			firstPaymentPaidAt: firstPaidAt ?? enrollment.firstPaymentPaidAt,
			fullyPaidAt,
		},
	});

	await notifyCollectionStatusChange(
		previous,
		collectionStatus,
		enrollmentId,
		enrollment.user.email,
	);

	await applyAccessPolicy(enrollmentId);
}

function paymentFieldsFromInvoice(
	invoice: Stripe.Invoice,
	status: PaymentStatus,
	failureReason: string | null,
	paymentIntentId: string | undefined,
) {
	return {
		stripeInvoiceId: invoice.id,
		stripePaymentIntentId: paymentIntentId,
		amountCents: invoice.amount_paid || invoice.amount_due || 0,
		currency: invoice.currency ?? 'eur',
		status,
		failureReason,
		invoicePdfUrl: invoice.invoice_pdf ?? null,
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
		invoicedAt: invoice.created ? new Date(invoice.created * 1000) : null,
		paidAt: invoice.status_transitions?.paid_at
			? new Date(invoice.status_transitions.paid_at * 1000)
			: null,
		dueAt: invoice.due_date
			? new Date(invoice.due_date * 1000)
			: invoice.next_payment_attempt
				? new Date(invoice.next_payment_attempt * 1000)
				: null,
	};
}

async function resolvePaymentIntentId(invoice: Stripe.Invoice): Promise<string | undefined> {
	const fromPayload = paymentIntentIdFromInvoice(invoice);
	if (fromPayload || !invoice.id) return fromPayload;
	try {
		const fresh = await retrieveInvoice(invoice.id);
		return paymentIntentIdFromInvoice(fresh);
	} catch (error) {
		console.warn('[payments] retrieve invoice for PI', invoice.id, error);
		return undefined;
	}
}

export async function syncStripeInvoice(
	invoice: Stripe.Invoice,
	options: {
		enrollmentId?: string;
		forceStatus?: PaymentStatus;
	} = {},
) {
	const subscriptionId = subscriptionIdFromInvoice(invoice);

	const prisma = getPrisma();
	let enrollment: EnrollmentWithUser | null = null;

	if (options.enrollmentId) {
		enrollment = await findEnrollmentById(options.enrollmentId);
	} else if (subscriptionId) {
		enrollment = await findEnrollmentBySubscriptionId(subscriptionId);
	}

	if (!enrollment) {
		const metaId =
			invoice.metadata?.enrollmentId ??
			(invoice as InvoiceExtras).subscription_details?.metadata?.enrollmentId;
		if (metaId) {
			enrollment = await findEnrollmentById(metaId);
		}
	}

	if (!enrollment) {
		const paymentIntentId = paymentIntentIdFromInvoice(invoice);
		if (paymentIntentId) {
			const byPi = await findEnrollmentIdByPaymentIntentId(paymentIntentId);
			if (byPi) enrollment = await findEnrollmentById(byPi);
		}
	}

	if (!enrollment) {
		return { ok: false as const, reason: 'enrollment_not_found' };
	}

	const installmentNumber = await resolveInstallmentNumber(enrollment.id, invoice);
	const status = options.forceStatus ?? mapInvoiceStatus(invoice.status);
	const failureReason =
		invoice.last_finalization_error?.message ??
		(invoice.status === 'open' && invoice.attempt_count > 0
			? `Tentative ${invoice.attempt_count}`
			: null);

	const paymentIntentId = await resolvePaymentIntentId(invoice);
	const fields = paymentFieldsFromInvoice(invoice, status, failureReason, paymentIntentId);

	const previous = await prisma.payment.findUnique({
		where: {
			enrollmentId_installmentNumber: {
				enrollmentId: enrollment.id,
				installmentNumber,
			},
		},
		select: { status: true },
	});
	const becamePaid = status === 'paid' && previous?.status !== 'paid';

	await prisma.payment.upsert({
		where: {
			enrollmentId_installmentNumber: {
				enrollmentId: enrollment.id,
				installmentNumber,
			},
		},
		create: {
			enrollmentId: enrollment.id,
			installmentNumber,
			...fields,
		},
		update: fields,
	});

	await recomputeEnrollmentCollectionState(enrollment.id);

	if (becamePaid) {
		await notifyInstallmentPaid(enrollment, installmentNumber, fields.amountCents);
	}

	return { ok: true as const, enrollmentId: enrollment.id };
}
