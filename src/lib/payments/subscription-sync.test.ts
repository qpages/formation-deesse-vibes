import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const {
	enrollmentUpdate,
	findEnrollmentById,
	findEnrollmentBySubscriptionId,
	findEnrollmentByScheduleOrSubscription,
	listSubscriptionInvoices,
	retrieveSubscription,
	retrieveSubscriptionSchedule,
	createPreviewInvoice,
	syncStripeInvoice,
	recomputeEnrollmentCollectionState,
} = vi.hoisted(() => ({
	enrollmentUpdate: vi.fn(),
	findEnrollmentById: vi.fn(),
	findEnrollmentBySubscriptionId: vi.fn(),
	findEnrollmentByScheduleOrSubscription: vi.fn(),
	listSubscriptionInvoices: vi.fn(),
	retrieveSubscription: vi.fn(),
	retrieveSubscriptionSchedule: vi.fn(),
	createPreviewInvoice: vi.fn(),
	syncStripeInvoice: vi.fn(),
	recomputeEnrollmentCollectionState: vi.fn(),
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
	retrieveSubscriptionSchedule,
	createPreviewInvoice,
}));

vi.mock('./invoice-sync', () => ({
	syncStripeInvoice,
	recomputeEnrollmentCollectionState,
}));

import {
	markSubscriptionScheduleCompleted,
	syncAllSubscriptionInvoices,
	syncEnrollmentSubscriptionDates,
	syncSubscriptionScheduleState,
	syncSubscriptionState,
} from './subscription-sync';

function subscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
	return {
		id: 'sub_1',
		object: 'subscription',
		status: 'active',
		metadata: {},
		schedule: 'sched_1',
		cancel_at: null,
		items: { data: [{ current_period_end: 1_800_000_000 }] },
		...overrides,
	} as Stripe.Subscription;
}

beforeEach(() => {
	vi.clearAllMocks();
	enrollmentUpdate.mockResolvedValue({});
	recomputeEnrollmentCollectionState.mockResolvedValue(undefined);
	createPreviewInvoice.mockResolvedValue({ period_end: 1_800_000_000 });
	retrieveSubscriptionSchedule.mockResolvedValue({
		id: 'sched_1',
		end_behavior: 'cancel',
		phases: [{ end_date: 1_900_000_000 }],
	});
});

describe('syncEnrollmentSubscriptionDates', () => {
	it('persiste les dates Stripe et recompte la collection', async () => {
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			stripeSubscriptionId: 'sub_1',
			stripeScheduleId: 'sched_1',
		});
		retrieveSubscription.mockResolvedValue(subscription());

		const result = await syncEnrollmentSubscriptionDates('enr_1');

		expect(retrieveSubscription).toHaveBeenCalledWith('sub_1');
		expect(createPreviewInvoice).toHaveBeenCalledWith({
			subscriptionId: 'sub_1',
			scheduleId: 'sched_1',
		});
		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: expect.objectContaining({
				currentPeriodEnd: expect.any(Date),
				subscriptionEndsAt: expect.any(Date),
				stripeScheduleEndBehavior: 'cancel',
				subscriptionStatus: 'active',
			}),
		});
		expect(recomputeEnrollmentCollectionState).toHaveBeenCalledWith('enr_1', {
			previewDueAt: expect.any(Date),
		});
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});

	it('passe subscription et schedule à createPreviewInvoice (Stripe choisit schedule)', async () => {
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			stripeSubscriptionId: 'sub_1',
			stripeScheduleId: 'sched_1',
		});
		retrieveSubscription.mockResolvedValue(subscription());

		await syncEnrollmentSubscriptionDates('enr_1');

		expect(createPreviewInvoice).toHaveBeenCalledWith({
			subscriptionId: 'sub_1',
			scheduleId: 'sched_1',
		});
	});

	it('prévisualise via subscription seul sans schedule', async () => {
		findEnrollmentById.mockResolvedValue({
			id: 'enr_2',
			stripeSubscriptionId: 'sub_2',
			stripeScheduleId: null,
		});
		retrieveSubscription.mockResolvedValue(subscription({ id: 'sub_2', schedule: null }));

		await syncEnrollmentSubscriptionDates('enr_2');

		expect(retrieveSubscriptionSchedule).not.toHaveBeenCalled();
		expect(createPreviewInvoice).toHaveBeenCalledWith({
			subscriptionId: 'sub_2',
			scheduleId: undefined,
		});
	});
});

describe('syncSubscriptionState', () => {
	it('délègue à syncEnrollmentSubscriptionDates quand l’enrollment existe', async () => {
		findEnrollmentBySubscriptionId.mockResolvedValue({ id: 'enr_1' });
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			stripeSubscriptionId: 'sub_1',
			stripeScheduleId: 'sched_1',
		});
		retrieveSubscription.mockResolvedValue(subscription());

		const result = await syncSubscriptionState(subscription({ status: 'past_due' }));

		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
		expect(enrollmentUpdate).toHaveBeenCalled();
	});

	it('retrouve l’enrollment via metadata.enrollmentId si absent par subscription id', async () => {
		findEnrollmentBySubscriptionId.mockResolvedValue(null);
		findEnrollmentById.mockResolvedValue({
			id: 'enr_meta',
			stripeSubscriptionId: 'sub_1',
			stripeScheduleId: null,
		});
		retrieveSubscription.mockResolvedValue(
			subscription({ metadata: { enrollmentId: 'enr_meta' } }),
		);

		const result = await syncSubscriptionState(
			subscription({ metadata: { enrollmentId: 'enr_meta' } }),
		);

		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_meta' },
			data: { stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active' },
		});
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_meta' });
	});

	it('retourne enrollment_not_found sans metadata', async () => {
		findEnrollmentBySubscriptionId.mockResolvedValue(null);

		const result = await syncSubscriptionState(subscription());

		expect(result).toEqual({ ok: false, reason: 'enrollment_not_found' });
	});
});

describe('syncSubscriptionScheduleState', () => {
	it('sync les dates quand le schedule est trouvé', async () => {
		findEnrollmentByScheduleOrSubscription.mockResolvedValue({ id: 'enr_1' });
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			stripeSubscriptionId: 'sub_1',
			stripeScheduleId: 'sched_1',
		});
		retrieveSubscription.mockResolvedValue(subscription());

		const result = await syncSubscriptionScheduleState({
			id: 'sched_1',
			subscription: 'sub_1',
		} as Stripe.SubscriptionSchedule);

		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});
});

describe('markSubscriptionScheduleCompleted', () => {
	it('retourne no_subscription si le schedule n’a pas d’abo', async () => {
		const result = await markSubscriptionScheduleCompleted({
			id: 'sched_1',
			subscription: null,
		} as Stripe.SubscriptionSchedule);

		expect(result).toEqual({ ok: false, reason: 'no_subscription' });
	});

	it('sync le statut abo et efface la prochaine échéance', async () => {
		findEnrollmentByScheduleOrSubscription.mockResolvedValue({ id: 'enr_1' });
		retrieveSubscription.mockResolvedValue(subscription({ status: 'canceled' }));
		retrieveSubscriptionSchedule.mockResolvedValue({
			id: 'sched_1',
			end_behavior: 'cancel',
			phases: [{ end_date: 1_900_000_000 }],
		});

		const result = await markSubscriptionScheduleCompleted({
			id: 'sched_1',
			subscription: { id: 'sub_1' },
			end_behavior: 'cancel',
			phases: [{ end_date: 1_900_000_000 }],
		} as Stripe.SubscriptionSchedule);

		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: expect.objectContaining({
				subscriptionStatus: 'canceled',
				nextInstallmentDueAt: null,
				subscriptionEndsAt: expect.any(Date),
			}),
		});
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});
});

describe('syncAllSubscriptionInvoices', () => {
	it('sync chaque facture puis les dates abo', async () => {
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			stripeSubscriptionId: 'sub_1',
			stripeScheduleId: 'sched_1',
		});
		listSubscriptionInvoices.mockResolvedValue({
			data: [{ id: 'in_1' }, { id: 'in_2' }],
		});
		retrieveSubscription.mockResolvedValue(subscription());

		const result = await syncAllSubscriptionInvoices('enr_1');

		expect(syncStripeInvoice).toHaveBeenCalledTimes(2);
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});
});
