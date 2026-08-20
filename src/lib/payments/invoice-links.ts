import type Stripe from 'stripe';
import type { Payment } from '../../generated/prisma/client';
import { paidInvoiceLabel } from '../payment-plans';
import { getPrisma } from '../prisma';
import {
	findInvoiceByPaymentIntent,
	paymentIntentIdFromInvoice,
	retrieveInvoice,
} from '../stripe';

export type PaidInvoiceLink = {
	installmentNumber: number;
	label: string;
	viewUrl: string | null;
	downloadUrl: string | null;
};

function invoiceLinkFields(invoice: Stripe.Invoice) {
	return {
		stripeInvoiceId: invoice.id,
		invoicePdfUrl: invoice.invoice_pdf ?? null,
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
		invoicedAt: invoice.created ? new Date(invoice.created * 1000) : null,
		paidAt: invoice.status_transitions?.paid_at
			? new Date(invoice.status_transitions.paid_at * 1000)
			: null,
	};
}

async function attachInvoiceToPayment(payment: Payment, invoice: Stripe.Invoice): Promise<Payment> {
	const fields = invoiceLinkFields(invoice);
	try {
		return await getPrisma().payment.update({
			where: { id: payment.id },
			data: {
				...fields,
				stripePaymentIntentId: paymentIntentIdFromInvoice(invoice) ?? payment.stripePaymentIntentId,
				paidAt: fields.paidAt ?? payment.paidAt,
			},
		});
	} catch (error) {
		if (
			typeof error === 'object' &&
			error &&
			'code' in error &&
			(error as { code: string }).code === 'P2002'
		) {
			return getPrisma().payment.update({
				where: { id: payment.id },
				data: {
					invoicePdfUrl: fields.invoicePdfUrl ?? payment.invoicePdfUrl,
					hostedInvoiceUrl: fields.hostedInvoiceUrl ?? payment.hostedInvoiceUrl,
				},
			});
		}
		throw error;
	}
}

/** Recharge les URLs Stripe (PDF + page) ; sans invoice id, cherche via PaymentIntent. */
export async function hydrateInvoiceUrls(payments: Payment[]): Promise<Payment[]> {
	const missing = payments.filter(
		(payment) =>
			(payment.stripeInvoiceId &&
				(!payment.invoicePdfUrl || !payment.hostedInvoiceUrl || !payment.stripePaymentIntentId)) ||
			(!payment.stripeInvoiceId && payment.stripePaymentIntentId),
	);
	if (missing.length === 0) return payments;

	const byId = new Map(payments.map((payment) => [payment.id, payment]));

	await Promise.all(
		missing.map(async (payment) => {
			try {
				const invoice = payment.stripeInvoiceId
					? await retrieveInvoice(payment.stripeInvoiceId)
					: await findInvoiceByPaymentIntent(payment.stripePaymentIntentId!);
				if (!invoice) return;

				const invoicePdfUrl = invoice.invoice_pdf ?? payment.invoicePdfUrl;
				const hostedInvoiceUrl = invoice.hosted_invoice_url ?? payment.hostedInvoiceUrl;
				const paymentIntentId =
					paymentIntentIdFromInvoice(invoice) ?? payment.stripePaymentIntentId;
				const sameLinks =
					Boolean(payment.stripeInvoiceId) &&
					Boolean(payment.stripePaymentIntentId) &&
					invoicePdfUrl === payment.invoicePdfUrl &&
					hostedInvoiceUrl === payment.hostedInvoiceUrl;
				if (sameLinks && paymentIntentId === payment.stripePaymentIntentId) return;

				const updated = await attachInvoiceToPayment(payment, invoice);
				byId.set(payment.id, updated);
			} catch (error) {
				console.error(
					'[payments] hydrate invoice',
					payment.stripeInvoiceId ?? payment.stripePaymentIntentId,
					error,
				);
			}
		}),
	);

	return payments.map((payment) => byId.get(payment.id) ?? payment);
}

/** Une ligne par paiement réussi : voir (page Stripe) + télécharger (PDF). */
export async function listPaidInvoiceLinks(enrollmentId: string): Promise<PaidInvoiceLink[]> {
	const payments = await getPrisma().payment.findMany({
		where: { enrollmentId, status: 'paid' },
		orderBy: { installmentNumber: 'asc' },
	});
	const hydrated = await hydrateInvoiceUrls(payments);

	return hydrated.map((payment) => ({
		installmentNumber: payment.installmentNumber,
		label: paidInvoiceLabel(payment.amountCents, payment.paidAt, payment.currency),
		viewUrl: payment.hostedInvoiceUrl,
		downloadUrl: payment.invoicePdfUrl,
	}));
}
