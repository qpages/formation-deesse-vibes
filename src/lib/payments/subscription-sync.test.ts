import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const {
	enrollmentUpdate,
	findEnrollmentById,
	findEnrollmentBySubscriptionId,
	findEnrollmentByScheduleOrSubscription,
	listSubscriptionInvoices,
	retrieveSubscription,
	syncStripeInvoice,
} = vi.hoisted(() => ({
	enrollmentUpdate: vi.fn(),
	findEnrollmentById: vi.fn(),
	findEnrollmentBySubscriptionId: vi.fn(),
	findEnrollmentByScheduleOrSubscription: vi.fn(),
	listSubscriptionInvoices: vi.fn(),
	retrieveSubscription: vi.fn(),
	syncStripeInvoice: vi.fn(),
}));

vi.mock('../prisma', () => ({
	getPrisma: () => ({
		enrollment: { update: enrollmentUpdate },
	}),
}));

vi.mock('../enrollment', () => ({
	findEnrollmentById,
	findEnrollmentBySubscriptionId,
	findEnrollmentByScheduleOrSubscription,
}));

vi.mock('../stripe', () => ({
	listSubscriptionInvoices,
	retrieveSubscription,
}));

vi.mock('./invoice-sync', () => ({
	syncStripeInvoice,
}));

import {
	markSubscriptionScheduleCompleted,
	syncAllSubscriptionInvoices,
	syncSubscriptionState,
} from './subscription-sync';

function subscription(
	overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
	return {
		id: 'sub_1',
		object: 'subscription',
		status: 'active',
		metadata: {},
		schedule: 'sched_1',
		...overrides,
	} as Stripe.Subscription;
}

beforeEach(() => {
	vi.clearAllMocks();
	enrollmentUpdate.mockResolvedValue({});
});

describe('syncSubscriptionState', () => {
	it('met à jour le statut quand l’enrollment est trouvé par subscription id', async () => {
		findEnrollmentBySubscriptionId.mockResolvedValue({ id: 'enr_1' });

		const result = await syncSubscriptionState(subscription({ status: 'past_due' }));

		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: {
				subscriptionStatus: 'past_due',
				stripeScheduleId: 'sched_1',
			},
		});
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});

	it('retrouve l’enrollment via metadata.enrollmentId si absent par subscription id', async () => {
		findEnrollmentBySubscriptionId.mockResolvedValue(null);
		findEnrollmentById.mockResolvedValue({ id: 'enr_meta' });

		const result = await syncSubscriptionState(
			subscription({ metadata: { enrollmentId: 'enr_meta' } }),
		);

		expect(findEnrollmentById).toHaveBeenCalledWith('enr_meta');
		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_meta' },
			data: {
				stripeSubscriptionId: 'sub_1',
				subscriptionStatus: 'active',
			},
		});
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_meta' });
	});

	it('retourne enrollment_not_found sans metadata', async () => {
		findEnrollmentBySubscriptionId.mockResolvedValue(null);

		const result = await syncSubscriptionState(subscription());

		expect(result).toEqual({ ok: false, reason: 'enrollment_not_found' });
		expect(enrollmentUpdate).not.toHaveBeenCalled();
	});

	it('retourne enrollment_not_found si metadata pointe vers un id inconnu', async () => {
		findEnrollmentBySubscriptionId.mockResolvedValue(null);
		findEnrollmentById.mockResolvedValue(null);

		const result = await syncSubscriptionState(
			subscription({ metadata: { enrollmentId: 'enr_missing' } }),
		);

		expect(result).toEqual({ ok: false, reason: 'enrollment_not_found' });
		expect(enrollmentUpdate).not.toHaveBeenCalled();
	});
});

describe('markSubscriptionScheduleCompleted', () => {
	it('retourne no_subscription si le schedule n’a pas d’abo', async () => {
		const result = await markSubscriptionScheduleCompleted({
			id: 'sched_1',
			subscription: null,
		} as Stripe.SubscriptionSchedule);

		expect(result).toEqual({ ok: false, reason: 'no_subscription' });
		expect(findEnrollmentByScheduleOrSubscription).not.toHaveBeenCalled();
	});

	it('retourne enrollment_not_found si aucune inscription ne correspond', async () => {
		findEnrollmentByScheduleOrSubscription.mockResolvedValue(null);

		const result = await markSubscriptionScheduleCompleted({
			id: 'sched_1',
			subscription: 'sub_1',
		} as Stripe.SubscriptionSchedule);

		expect(findEnrollmentByScheduleOrSubscription).toHaveBeenCalledWith('sched_1', 'sub_1');
		expect(result).toEqual({ ok: false, reason: 'enrollment_not_found' });
	});

	it('sync le statut abo et efface la prochaine échéance', async () => {
		findEnrollmentByScheduleOrSubscription.mockResolvedValue({ id: 'enr_1' });
		retrieveSubscription.mockResolvedValue(subscription({ status: 'canceled' }));

		const result = await markSubscriptionScheduleCompleted({
			id: 'sched_1',
			subscription: { id: 'sub_1' },
		} as Stripe.SubscriptionSchedule);

		expect(retrieveSubscription).toHaveBeenCalledWith('sub_1');
		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: {
				subscriptionStatus: 'canceled',
				nextInstallmentDueAt: null,
			},
		});
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});
});

describe('syncAllSubscriptionInvoices', () => {
	it('retourne no_subscription sans stripeSubscriptionId', async () => {
		findEnrollmentById.mockResolvedValue({ id: 'enr_1', stripeSubscriptionId: null });

		const result = await syncAllSubscriptionInvoices('enr_1');

		expect(result).toEqual({ ok: false, reason: 'no_subscription' });
		expect(listSubscriptionInvoices).not.toHaveBeenCalled();
	});

	it('sync chaque facture puis l’état de l’abonnement', async () => {
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			stripeSubscriptionId: 'sub_1',
		});
		listSubscriptionInvoices.mockResolvedValue({
			data: [{ id: 'in_1' }, { id: 'in_2' }],
		});
		retrieveSubscription.mockResolvedValue(subscription());
		findEnrollmentBySubscriptionId.mockResolvedValue({ id: 'enr_1' });

		const result = await syncAllSubscriptionInvoices('enr_1');

		expect(listSubscriptionInvoices).toHaveBeenCalledWith('sub_1');
		expect(syncStripeInvoice).toHaveBeenCalledTimes(2);
		expect(syncStripeInvoice).toHaveBeenCalledWith({ id: 'in_1' }, { enrollmentId: 'enr_1' });
		expect(syncStripeInvoice).toHaveBeenCalledWith({ id: 'in_2' }, { enrollmentId: 'enr_1' });
		expect(retrieveSubscription).toHaveBeenCalledWith('sub_1');
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});
});
