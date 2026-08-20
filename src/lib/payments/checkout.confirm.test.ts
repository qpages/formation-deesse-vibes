import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const {
	applyAccessPolicy,
	ensureNdaAfterPayment,
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	getPrisma,
	recomputeEnrollmentCollectionState,
	syncStripeInvoice,
	syncEnrollmentSubscriptionDates,
	updateMany,
	userUpdate,
	enrollmentUpdate,
	paymentUpsert,
	paymentFindUnique,
	findInvoiceForPaidCheckout,
	getStripe,
	retrieveSubscription,
	ensureSubscriptionSchedule,
	notifyOps,
	notifyInstallmentPaid,
} = vi.hoisted(() => ({
	applyAccessPolicy: vi.fn(),
	ensureNdaAfterPayment: vi.fn(),
	findEnrollmentById: vi.fn(),
	findEnrollmentByIdOrThrow: vi.fn(),
	getPrisma: vi.fn(),
	recomputeEnrollmentCollectionState: vi.fn(),
	syncStripeInvoice: vi.fn(),
	syncEnrollmentSubscriptionDates: vi.fn(),
	updateMany: vi.fn(),
	userUpdate: vi.fn(),
	enrollmentUpdate: vi.fn(),
	paymentUpsert: vi.fn(),
	paymentFindUnique: vi.fn(),
	findInvoiceForPaidCheckout: vi.fn(),
	getStripe: vi.fn(),
	retrieveSubscription: vi.fn(),
	ensureSubscriptionSchedule: vi.fn(),
	notifyOps: vi.fn(),
	notifyInstallmentPaid: vi.fn(),
}));

vi.mock('../prisma', () => ({
	getPrisma: () => ({
		enrollment: { updateMany, update: enrollmentUpdate },
		user: { update: userUpdate },
		payment: { upsert: paymentUpsert, findUnique: paymentFindUnique },
	}),
}));

vi.mock('../enrollment', () => ({
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	attachStripeCheckoutSession: vi.fn(),
}));

vi.mock('../enrollment/access', () => ({ applyAccessPolicy }));
vi.mock('./nda-trigger', () => ({ ensureNdaAfterPayment }));
vi.mock('./invoice-sync', () => ({
	recomputeEnrollmentCollectionState,
	syncStripeInvoice,
}));
vi.mock('./subscription-sync', () => ({ syncEnrollmentSubscriptionDates }));
vi.mock('../stripe', () => ({
	findInvoiceForPaidCheckout,
	getStripe,
	retrieveSubscription,
	ensureSubscriptionSchedule,
	createCheckoutSession: vi.fn(),
	expireCheckoutSession: vi.fn(),
	retrieveCheckoutSession: vi.fn(),
}));
vi.mock('../payment-plans', () => ({
	getPaymentPlan: vi.fn(() => ({
		id: 'x2',
		mode: 'subscription',
		installments: 2,
		installmentAmountCents: 94_950,
		totalAmountCents: 189_900,
	})),
	stripePriceIdForPlan: vi.fn(() => 'price_x2'),
	resolvePaymentPlan: vi.fn((id: string) => ({
		id,
		mode: 'subscription',
		installments: 2,
		installmentAmountCents: 94_950,
		totalAmountCents: 189_900,
	})),
}));

vi.mock('../services/slack', () => ({ notifyOps }));
vi.mock('./notifications', () => ({ notifyInstallmentPaid }));

import { confirmPaidCheckout } from './checkout';

function session(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
	return {
		object: 'checkout.session',
		id: 'cs_test',
		payment_status: 'paid',
		amount_total: 10000,
		mode: 'payment',
		metadata: { enrollmentId: 'enr_1', paymentPlan: 'unique' },
		client_reference_id: 'enr_1',
		...overrides,
	} as Stripe.Checkout.Session;
}

const baseEnrollment = {
	id: 'enr_1',
	userId: 'usr_1',
	collectionStatus: 'current' as const,
	contractStatus: 'pending' as const,
	stripeCheckoutSessionId: 'cs_test',
	stripeSubscriptionId: null as string | null,
	stripeScheduleId: null as string | null,
	amountCents: 10000,
	paymentPlan: 'unique' as const,
	user: { id: 'usr_1', email: 'a@b.c', firstName: 'A', lastName: 'B', stripeCustomerId: null },
};

beforeEach(() => {
	vi.clearAllMocks();
	findEnrollmentById.mockResolvedValue({ ...baseEnrollment });
	findEnrollmentByIdOrThrow.mockResolvedValue({ ...baseEnrollment });
	ensureNdaAfterPayment.mockResolvedValue({ status: 'skipped' });
	findInvoiceForPaidCheckout.mockResolvedValue(null);
	paymentFindUnique.mockResolvedValue(null);
});

describe('confirmPaidCheckout early return', () => {
	it('skip le sync lourd si déjà confirmé avec la même session (one-time)', async () => {
		const result = await confirmPaidCheckout(session());

		expect(result).toMatchObject({
			ok: true,
			enrollmentId: 'enr_1',
			alreadyConfirmed: true,
			contractStatus: 'pending',
		});
		expect(updateMany).not.toHaveBeenCalled();
		expect(paymentUpsert).not.toHaveBeenCalled();
		expect(applyAccessPolicy).not.toHaveBeenCalled();
		expect(ensureNdaAfterPayment).not.toHaveBeenCalled();
		expect(syncStripeInvoice).not.toHaveBeenCalled();
	});

	it('skip le sync lourd si déjà confirmé avec la même session (subscription)', async () => {
		findEnrollmentById.mockResolvedValue({
			...baseEnrollment,
			stripeSubscriptionId: 'sub_1',
		});
		findEnrollmentByIdOrThrow.mockResolvedValue({
			...baseEnrollment,
			stripeSubscriptionId: 'sub_1',
		});

		const result = await confirmPaidCheckout(
			session({
				mode: 'subscription',
				subscription: 'sub_1',
				metadata: { enrollmentId: 'enr_1', paymentPlan: 'x2' },
			}),
		);

		expect(result.ok).toBe(true);
		expect(result.ok && result.alreadyConfirmed).toBe(true);
		expect(enrollmentUpdate).not.toHaveBeenCalled();
		expect(retrieveSubscription).not.toHaveBeenCalled();
		expect(ensureNdaAfterPayment).not.toHaveBeenCalled();
	});

	it('ne skip pas si subscription id manquant sur l’inscription', async () => {
		findEnrollmentById.mockResolvedValue({
			...baseEnrollment,
			stripeSubscriptionId: null,
		});
		updateMany.mockResolvedValue({ count: 0 });
		findEnrollmentByIdOrThrow.mockResolvedValue({
			...baseEnrollment,
			stripeSubscriptionId: null,
		});
		ensureSubscriptionSchedule.mockResolvedValue('sched_1');
		retrieveSubscription.mockResolvedValue({ latest_invoice: null });
		getStripe.mockReturnValue({ invoices: { retrieve: vi.fn() } });

		await confirmPaidCheckout(
			session({
				mode: 'subscription',
				subscription: 'sub_1',
				metadata: { enrollmentId: 'enr_1', paymentPlan: 'x2' },
			}),
		);

		expect(ensureSubscriptionSchedule).toHaveBeenCalled();
		expect(applyAccessPolicy).toHaveBeenCalledWith('enr_1');
	});

	it('ne skip pas pour session stale encore pending', async () => {
		findEnrollmentById.mockResolvedValue({
			...baseEnrollment,
			collectionStatus: 'pending',
			stripeCheckoutSessionId: 'cs_newer',
		});
		updateMany.mockResolvedValue({ count: 1 });
		findEnrollmentByIdOrThrow.mockResolvedValue({
			...baseEnrollment,
			collectionStatus: 'current',
		});

		await confirmPaidCheckout(session({ id: 'cs_stale' }));

		expect(updateMany).toHaveBeenCalled();
		expect(applyAccessPolicy).toHaveBeenCalledWith('enr_1');
		expect(ensureNdaAfterPayment).toHaveBeenCalled();
	});

	it('ne skip pas si session id différente sur inscription déjà confirmée', async () => {
		findEnrollmentById.mockResolvedValue({
			...baseEnrollment,
			stripeCheckoutSessionId: 'cs_other',
		});
		updateMany.mockResolvedValue({ count: 0 });
		findEnrollmentByIdOrThrow.mockResolvedValue({
			...baseEnrollment,
			stripeCheckoutSessionId: 'cs_other',
		});

		await confirmPaidCheckout(session({ id: 'cs_test' }));

		expect(paymentUpsert).toHaveBeenCalled();
		expect(applyAccessPolicy).toHaveBeenCalledWith('enr_1');
	});
});
