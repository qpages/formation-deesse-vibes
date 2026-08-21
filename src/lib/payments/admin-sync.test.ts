import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	findEnrollmentById,
	paymentFindMany,
	retrieveCheckoutSession,
	confirmPaidCheckout,
	hydrateInvoiceUrls,
	recomputeEnrollmentCollectionState,
	ensureNdaAfterPayment,
	syncAllSubscriptionInvoices,
} = vi.hoisted(() => ({
	findEnrollmentById: vi.fn(),
	paymentFindMany: vi.fn(),
	retrieveCheckoutSession: vi.fn(),
	confirmPaidCheckout: vi.fn(),
	hydrateInvoiceUrls: vi.fn(),
	recomputeEnrollmentCollectionState: vi.fn(),
	ensureNdaAfterPayment: vi.fn(),
	syncAllSubscriptionInvoices: vi.fn(),
}));

vi.mock('../prisma', () => ({
	getPrisma: () => ({
		payment: { findMany: paymentFindMany },
	}),
}));

vi.mock('../enrollment', () => ({ findEnrollmentById }));
vi.mock('../stripe', () => ({ retrieveCheckoutSession }));
vi.mock('./checkout', () => ({ confirmPaidCheckout }));
vi.mock('./invoice-links', () => ({ hydrateInvoiceUrls }));
vi.mock('./invoice-sync', () => ({ recomputeEnrollmentCollectionState }));
vi.mock('./nda-trigger', () => ({ ensureNdaAfterPayment }));
vi.mock('./subscription-sync', () => ({ syncAllSubscriptionInvoices }));

import { syncPaymentFromStripe } from './admin-sync';

const paidEnrollment = {
	id: 'enr_1',
	collectionStatus: 'current' as const,
	contractStatus: 'pending' as const,
	stripeCheckoutSessionId: 'cs_1',
	stripeSubscriptionId: null as string | null,
};

beforeEach(() => {
	vi.clearAllMocks();
	hydrateInvoiceUrls.mockImplementation(async (payments: unknown[]) => payments);
	ensureNdaAfterPayment.mockResolvedValue({ status: 'skipped' });
});

describe('syncPaymentFromStripe', () => {
	it('retourne enrollment_not_found si l’inscription est absente', async () => {
		findEnrollmentById.mockResolvedValue(null);

		const result = await syncPaymentFromStripe('enr_missing');

		expect(result).toEqual({ ok: false, reason: 'enrollment_not_found' });
	});

	it('répare une inscription déjà payée avec abonnement via sync des factures', async () => {
		findEnrollmentById.mockResolvedValue({
			...paidEnrollment,
			stripeSubscriptionId: 'sub_1',
		});
		syncAllSubscriptionInvoices.mockResolvedValue({ ok: true, enrollmentId: 'enr_1' });

		const result = await syncPaymentFromStripe('enr_1');

		expect(syncAllSubscriptionInvoices).toHaveBeenCalledWith('enr_1');
		expect(hydrateInvoiceUrls).not.toHaveBeenCalled();
		expect(ensureNdaAfterPayment).toHaveBeenCalledWith('enr_1', 'cs_1', { soft: true });
		expect(result).toEqual({
			ok: true,
			enrollmentId: 'enr_1',
			alreadyConfirmed: true,
			contractStatus: 'pending',
			ndaEnqueue: { status: 'skipped' },
		});
	});

	it('répare une inscription déjà payée sans abonnement via hydrate + recompute', async () => {
		findEnrollmentById.mockResolvedValue(paidEnrollment);
		paymentFindMany.mockResolvedValue([{ id: 'pay_1' }]);

		const result = await syncPaymentFromStripe('enr_1');

		expect(paymentFindMany).toHaveBeenCalledWith({
			where: { enrollmentId: 'enr_1' },
			orderBy: { installmentNumber: 'asc' },
		});
		expect(hydrateInvoiceUrls).toHaveBeenCalledWith([{ id: 'pay_1' }]);
		expect(recomputeEnrollmentCollectionState).toHaveBeenCalledWith('enr_1');
		expect(syncAllSubscriptionInvoices).not.toHaveBeenCalled();
		expect(ensureNdaAfterPayment).toHaveBeenCalledWith('enr_1', 'cs_1', { soft: true });
		expect(result.ok).toBe(true);
	});

	it('utilise un identifiant admin-sync pour le NDA si pas de session checkout', async () => {
		findEnrollmentById.mockResolvedValue({
			...paidEnrollment,
			stripeCheckoutSessionId: null,
		});
		paymentFindMany.mockResolvedValue([]);

		await syncPaymentFromStripe('enr_1');

		expect(ensureNdaAfterPayment).toHaveBeenCalledWith('enr_1', 'admin-sync:enr_1', {
			soft: true,
		});
	});

	it('retourne no_checkout_session si encore pending sans session', async () => {
		findEnrollmentById.mockResolvedValue({
			...paidEnrollment,
			collectionStatus: 'pending',
			stripeCheckoutSessionId: null,
		});

		const result = await syncPaymentFromStripe('enr_1');

		expect(result).toEqual({ ok: false, reason: 'no_checkout_session' });
		expect(retrieveCheckoutSession).not.toHaveBeenCalled();
	});

	it('confirme le checkout pending puis sync les factures abo si besoin', async () => {
		findEnrollmentById.mockResolvedValue({
			...paidEnrollment,
			collectionStatus: 'pending',
			stripeSubscriptionId: 'sub_1',
		});
		retrieveCheckoutSession.mockResolvedValue({ id: 'cs_1' });
		confirmPaidCheckout.mockResolvedValue({
			ok: true,
			enrollmentId: 'enr_1',
			alreadyConfirmed: false,
			contractStatus: 'pending',
		});

		const result = await syncPaymentFromStripe('enr_1');

		expect(retrieveCheckoutSession).toHaveBeenCalledWith('cs_1');
		expect(confirmPaidCheckout).toHaveBeenCalledWith({ id: 'cs_1' }, { softEnqueue: true });
		expect(syncAllSubscriptionInvoices).toHaveBeenCalledWith('enr_1');
		expect(result.ok).toBe(true);
	});

	it('confirme le checkout pending sans resync abo si pas de subscription', async () => {
		findEnrollmentById.mockResolvedValue({
			...paidEnrollment,
			collectionStatus: 'pending',
		});
		retrieveCheckoutSession.mockResolvedValue({ id: 'cs_1' });
		confirmPaidCheckout.mockResolvedValue({
			ok: true,
			enrollmentId: 'enr_1',
			alreadyConfirmed: false,
			contractStatus: 'pending',
		});

		await syncPaymentFromStripe('enr_1');

		expect(syncAllSubscriptionInvoices).not.toHaveBeenCalled();
	});
});
