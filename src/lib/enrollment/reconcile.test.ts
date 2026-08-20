import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	applyAccessPolicy,
	confirmLearnerNdaSignature,
	confirmPaidCheckout,
	ensureNdaAfterPayment,
	findEnrollmentById,
	getPrisma,
	hydrateInvoiceUrls,
	recomputeEnrollmentCollectionState,
	retrieveCheckoutSession,
	syncAllSubscriptionInvoices,
} = vi.hoisted(() => ({
	applyAccessPolicy: vi.fn(),
	confirmLearnerNdaSignature: vi.fn(),
	confirmPaidCheckout: vi.fn(),
	ensureNdaAfterPayment: vi.fn(),
	findEnrollmentById: vi.fn(),
	getPrisma: vi.fn(),
	hydrateInvoiceUrls: vi.fn(),
	recomputeEnrollmentCollectionState: vi.fn(),
	retrieveCheckoutSession: vi.fn(),
	syncAllSubscriptionInvoices: vi.fn(),
}));

vi.mock('../payments/checkout', () => ({ confirmPaidCheckout }));
vi.mock('../payments/nda-trigger', () => ({ ensureNdaAfterPayment }));
vi.mock('../payments/invoice-links', () => ({ hydrateInvoiceUrls }));
vi.mock('../payments/invoice-sync', () => ({ recomputeEnrollmentCollectionState }));
vi.mock('../payments/subscription-sync', () => ({ syncAllSubscriptionInvoices }));
vi.mock('../stripe', () => ({ retrieveCheckoutSession }));
vi.mock('../signature/nda-sync', () => ({ confirmLearnerNdaSignature }));
vi.mock('./access', () => ({ applyAccessPolicy }));
vi.mock('./queries', () => ({ findEnrollmentById }));
vi.mock('../prisma', () => ({
	getPrisma: () => ({
		payment: { findMany: vi.fn().mockResolvedValue([]) },
	}),
}));

import { reconcileEnrollment } from './reconcile';

function awaitingEnrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		collectionStatus: 'current',
		contractStatus: 'sent',
		accessStatus: 'not_eligible',
		stripeCheckoutSessionId: 'cs_1',
		ndaRequest: { externalRequestId: 'req_1' },
		user: { email: 'a@b.c' },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	applyAccessPolicy.mockResolvedValue({ emitted: null });
	ensureNdaAfterPayment.mockResolvedValue({ status: 'enqueued' });
	confirmLearnerNdaSignature.mockResolvedValue({
		ok: true,
		signed: false,
		followUp: { status: 'skipped' },
	});
});

describe('reconcileEnrollment scope', () => {
	it('access_only ne lance que applyAccessPolicy', async () => {
		await reconcileEnrollment('enr_1', 'cron.access_policy', 'access_only');

		expect(applyAccessPolicy).toHaveBeenCalledWith('enr_1');
		expect(confirmPaidCheckout).not.toHaveBeenCalled();
		expect(ensureNdaAfterPayment).not.toHaveBeenCalled();
		expect(confirmLearnerNdaSignature).not.toHaveBeenCalled();
	});

	it('nda_signature ne lance que confirmLearnerNdaSignature', async () => {
		findEnrollmentById.mockResolvedValue(awaitingEnrollment());

		await reconcileEnrollment('enr_1', 'client.nda_sync', 'nda_signature');

		expect(confirmLearnerNdaSignature).toHaveBeenCalledWith('enr_1');
		expect(confirmPaidCheckout).not.toHaveBeenCalled();
		expect(ensureNdaAfterPayment).not.toHaveBeenCalled();
		expect(applyAccessPolicy).not.toHaveBeenCalled();
	});
});

describe('reconcileEnrollment skip conditions', () => {
	it('skip nda_provision après confirmPaidCheckout (première confirmation)', async () => {
		findEnrollmentById.mockResolvedValue(
			awaitingEnrollment({ collectionStatus: 'pending', stripeCheckoutSessionId: 'cs_1' }),
		);
		retrieveCheckoutSession.mockResolvedValue({
			id: 'cs_1',
			metadata: { enrollmentId: 'enr_1' },
		});
		confirmPaidCheckout.mockResolvedValue({
			ok: true,
			enrollmentId: 'enr_1',
			alreadyConfirmed: false,
			contractStatus: 'pending',
		});

		await reconcileEnrollment('enr_1', 'page.home', 'full');

		expect(confirmPaidCheckout).toHaveBeenCalled();
		expect(ensureNdaAfterPayment).not.toHaveBeenCalled();
		expect(applyAccessPolicy).not.toHaveBeenCalled();
	});

	it('relance nda_provision si confirmPaidCheckout déjà confirmé (early return)', async () => {
		let calls = 0;
		findEnrollmentById.mockImplementation(async () => {
			calls += 1;
			if (calls === 1) {
				return awaitingEnrollment({
					collectionStatus: 'pending',
					stripeCheckoutSessionId: 'cs_1',
				});
			}
			return awaitingEnrollment({
				collectionStatus: 'current',
				contractStatus: 'sent',
				stripeCheckoutSessionId: 'cs_1',
			});
		});
		retrieveCheckoutSession.mockResolvedValue({
			id: 'cs_1',
			metadata: { enrollmentId: 'enr_1' },
		});
		confirmPaidCheckout.mockResolvedValue({
			ok: true,
			enrollmentId: 'enr_1',
			alreadyConfirmed: true,
			contractStatus: 'sent',
		});

		await reconcileEnrollment('enr_1', 'page.home', 'full');

		expect(ensureNdaAfterPayment).toHaveBeenCalledWith('enr_1', 'cs_1', { soft: true });
		expect(applyAccessPolicy).toHaveBeenCalledWith('enr_1');
	});

	it('nda_provision soft hors webhook.stripe', async () => {
		findEnrollmentById.mockResolvedValue(awaitingEnrollment());

		await reconcileEnrollment('enr_1', 'page.home', 'nda_provision');

		expect(ensureNdaAfterPayment).toHaveBeenCalledWith('enr_1', 'cs_1', { soft: true });
	});

	it('nda_provision dur pour webhook.stripe', async () => {
		findEnrollmentById.mockResolvedValue(awaitingEnrollment());

		await reconcileEnrollment('enr_1', 'webhook.stripe', 'nda_provision');

		expect(ensureNdaAfterPayment).toHaveBeenCalledWith('enr_1', 'cs_1', { soft: false });
	});

	it('admin.sync_payment déjà payé répare factures sans confirmPaidCheckout', async () => {
		findEnrollmentById.mockResolvedValue(
			awaitingEnrollment({
				collectionStatus: 'current',
				stripeSubscriptionId: 'sub_1',
			}),
		);

		await reconcileEnrollment('enr_1', 'admin.sync_payment', 'payment');

		expect(syncAllSubscriptionInvoices).toHaveBeenCalledWith('enr_1');
		expect(confirmPaidCheckout).not.toHaveBeenCalled();
	});
});

describe('reconcileEnrollment mutations', () => {
	it('mutated=true quand signature confirmée', async () => {
		findEnrollmentById.mockResolvedValue(awaitingEnrollment());
		confirmLearnerNdaSignature.mockResolvedValue({
			ok: true,
			signed: true,
			followUp: { status: 'skipped' },
		});

		const result = await reconcileEnrollment('enr_1', 'page.home', 'nda_signature');

		expect(result.mutated).toBe(true);
	});
});
