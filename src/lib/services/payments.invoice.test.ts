import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Payment } from '../../generated/prisma/client';

const {
	paymentUpdate,
	paymentFindUnique,
	paymentFindFirst,
	paymentCount,
	paymentUpsert,
	paymentFindMany,
	enrollmentUpdate,
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	findEnrollmentBySubscriptionId,
	findEnrollmentIdByPaymentIntentId,
	findInvoiceByPaymentIntent,
	retrieveInvoice,
} = vi.hoisted(() => ({
	paymentUpdate: vi.fn(),
	paymentFindUnique: vi.fn(),
	paymentFindFirst: vi.fn(),
	paymentCount: vi.fn(),
	paymentUpsert: vi.fn(),
	paymentFindMany: vi.fn(),
	enrollmentUpdate: vi.fn(),
	findEnrollmentById: vi.fn(),
	findEnrollmentByIdOrThrow: vi.fn(),
	findEnrollmentBySubscriptionId: vi.fn(),
	findEnrollmentIdByPaymentIntentId: vi.fn(),
	findInvoiceByPaymentIntent: vi.fn(),
	retrieveInvoice: vi.fn(),
}));

vi.mock('../prisma', () => ({
	getPrisma: () => ({
		payment: {
			update: paymentUpdate,
			findUnique: paymentFindUnique,
			findFirst: paymentFindFirst,
			count: paymentCount,
			upsert: paymentUpsert,
			findMany: paymentFindMany,
		},
		enrollment: { update: enrollmentUpdate, updateMany: vi.fn() },
	}),
}));

vi.mock('./access', () => ({ applyAccessPolicy: vi.fn() }));
vi.mock('./slack', () => ({ notifyOps: vi.fn() }));
vi.mock('../inngest/client', () => ({ inngest: {}, sendInngestSafe: vi.fn() }));
vi.mock('./enrollment', () => ({
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	findEnrollmentBySubscriptionId,
	findEnrollmentByScheduleOrSubscription: vi.fn(),
	findEnrollmentIdByPaymentIntentId,
	attachStripeCheckoutSession: vi.fn(),
}));

vi.mock('../stripe', () => ({
	createCheckoutSession: vi.fn(),
	ensureSubscriptionSchedule: vi.fn(),
	expireCheckoutSession: vi.fn(),
	findInvoiceByPaymentIntent,
	findInvoiceForPaidCheckout: vi.fn(),
	getStripe: vi.fn(),
	listSubscriptionInvoices: vi.fn(),
	paymentIntentIdFromInvoice: (invoice: {
		payment_intent?: string;
		payments?: { data?: Array<{ payment?: { payment_intent?: string } }> };
	}) => invoice.payment_intent ?? invoice.payments?.data?.[0]?.payment?.payment_intent,
	retrieveCheckoutSession: vi.fn(),
	retrieveInvoice,
	retrieveSubscription: vi.fn(),
}));

import { hydrateInvoiceUrls, syncStripeInvoice } from './payments';

function payment(overrides: Partial<Payment> = {}): Payment {
	return {
		id: 'pay_1',
		enrollmentId: 'enr_1',
		stripeInvoiceId: null,
		stripePaymentIntentId: 'pi_1',
		installmentNumber: 1,
		amountCents: 184900,
		currency: 'eur',
		status: 'paid',
		failureReason: null,
		invoicePdfUrl: null,
		hostedInvoiceUrl: null,
		invoicedAt: null,
		paidAt: new Date('2026-08-17T13:26:00Z'),
		dueAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function enrollment() {
	return {
		id: 'enr_1',
		collectionStatus: 'paid',
		installmentsTotal: 1,
		installmentsPaid: 1,
		collectedAmountCents: 184900,
		fullyPaidAt: new Date(),
		firstPaymentPaidAt: new Date(),
		nextInstallmentDueAt: null,
		user: { email: 'eleve@example.com', firstName: 'Ada', lastName: 'Lovelace' },
		userId: 'user_1',
		paymentPlan: 'unique',
	};
}

const stripeInvoice = {
	id: 'in_1',
	amount_paid: 184900,
	amount_due: 0,
	currency: 'eur',
	status: 'paid',
	invoice_pdf: 'https://files.stripe.com/in_1.pdf',
	hosted_invoice_url: 'https://invoice.stripe.com/in_1',
	created: 1_755_000_000,
	status_transitions: { paid_at: 1_755_000_100 },
	payment_intent: 'pi_1',
	metadata: {},
	last_finalization_error: null,
	attempt_count: 1,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('hydrateInvoiceUrls', () => {
	it('sans stripeInvoiceId, cherche la facture via PaymentIntent', async () => {
		findInvoiceByPaymentIntent.mockResolvedValue(stripeInvoice);
		paymentUpdate.mockResolvedValue(
			payment({
				stripeInvoiceId: 'in_1',
				invoicePdfUrl: stripeInvoice.invoice_pdf,
				hostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
			}),
		);

		const [updated] = await hydrateInvoiceUrls([payment()]);

		expect(findInvoiceByPaymentIntent).toHaveBeenCalledWith('pi_1');
		expect(retrieveInvoice).not.toHaveBeenCalled();
		expect(paymentUpdate).toHaveBeenCalledWith({
			where: { id: 'pay_1' },
			data: expect.objectContaining({
				stripeInvoiceId: 'in_1',
				invoicePdfUrl: stripeInvoice.invoice_pdf,
				hostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
			}),
		});
		expect(updated?.stripeInvoiceId).toBe('in_1');
		expect(updated?.invoicePdfUrl).toBe(stripeInvoice.invoice_pdf);
	});

	it('avec invoice id, recharge seulement les URLs', async () => {
		retrieveInvoice.mockResolvedValue(stripeInvoice);
		paymentUpdate.mockResolvedValue(
			payment({
				stripeInvoiceId: 'in_1',
				invoicePdfUrl: stripeInvoice.invoice_pdf,
				hostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
			}),
		);

		await hydrateInvoiceUrls([payment({ stripeInvoiceId: 'in_1' })]);

		expect(retrieveInvoice).toHaveBeenCalledWith('in_1');
		expect(findInvoiceByPaymentIntent).not.toHaveBeenCalled();
	});

	it('ne rappelle pas Stripe si invoice + URLs + PI déjà là', async () => {
		const result = await hydrateInvoiceUrls([
			payment({
				stripeInvoiceId: 'in_1',
				invoicePdfUrl: 'https://pdf',
				hostedInvoiceUrl: 'https://hosted',
			}),
		]);

		expect(retrieveInvoice).not.toHaveBeenCalled();
		expect(findInvoiceByPaymentIntent).not.toHaveBeenCalled();
		expect(result[0]?.invoicePdfUrl).toBe('https://pdf');
	});

	it('invoice + URLs sans PI → récupère le PaymentIntent', async () => {
		retrieveInvoice.mockResolvedValue({
			...stripeInvoice,
			payment_intent: undefined,
			payments: {
				data: [
					{
						is_default: true,
						status: 'paid',
						payment: { payment_intent: 'pi_from_payments' },
					},
				],
			},
		});
		paymentUpdate.mockResolvedValue(
			payment({
				stripeInvoiceId: 'in_1',
				stripePaymentIntentId: 'pi_from_payments',
				invoicePdfUrl: stripeInvoice.invoice_pdf,
				hostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
			}),
		);

		const [updated] = await hydrateInvoiceUrls([
			payment({
				stripeInvoiceId: 'in_1',
				stripePaymentIntentId: null,
				invoicePdfUrl: stripeInvoice.invoice_pdf,
				hostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
			}),
		]);

		expect(retrieveInvoice).toHaveBeenCalledWith('in_1');
		expect(paymentUpdate).toHaveBeenCalledWith({
			where: { id: 'pay_1' },
			data: expect.objectContaining({ stripePaymentIntentId: 'pi_from_payments' }),
		});
		expect(updated?.stripePaymentIntentId).toBe('pi_from_payments');
	});
});

describe('syncStripeInvoice', () => {
	it('retrouve l’enrollment via PaymentIntent si metadata absente', async () => {
		findEnrollmentBySubscriptionId.mockResolvedValue(null);
		findEnrollmentIdByPaymentIntentId.mockResolvedValue('enr_1');
		findEnrollmentById.mockResolvedValue(enrollment());
		findEnrollmentByIdOrThrow.mockResolvedValue(enrollment());
		paymentFindUnique.mockResolvedValue(null);
		paymentFindFirst.mockResolvedValue(payment());
		paymentUpsert.mockResolvedValue(payment({ stripeInvoiceId: 'in_1' }));
		paymentFindMany.mockResolvedValue([payment({ stripeInvoiceId: 'in_1', status: 'paid' })]);
		enrollmentUpdate.mockResolvedValue({});

		const result = await syncStripeInvoice(stripeInvoice as never);

		expect(findEnrollmentIdByPaymentIntentId).toHaveBeenCalledWith('pi_1');
		expect(paymentUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					enrollmentId_installmentNumber: { enrollmentId: 'enr_1', installmentNumber: 1 },
				},
			}),
		);
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});
});
