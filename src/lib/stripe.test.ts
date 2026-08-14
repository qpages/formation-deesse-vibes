import { beforeEach, describe, expect, it, vi } from 'vitest';

const subscriptionsRetrieve = vi.fn();
const schedulesRetrieve = vi.fn();
const schedulesCreate = vi.fn();
const schedulesUpdate = vi.fn();

vi.mock('stripe', () => ({
	default: class {
		subscriptions = { retrieve: subscriptionsRetrieve };
		subscriptionSchedules = {
			retrieve: schedulesRetrieve,
			create: schedulesCreate,
			update: schedulesUpdate,
		};
		webhooks = {};
	},
}));

vi.mock('./env', () => ({
	requireEnv: () => 'sk_test_123',
	getEnv: () => ({ STRIPE_SECRET_KEY: 'sk_test_123' }),
}));

import { ensureSubscriptionSchedule } from './stripe';

const START = Math.floor(Date.UTC(2026, 0, 1) / 1000);

/** start + n mois (UTC), en secondes epoch — miroir de phaseMonths. */
function plusMonths(startSec: number, n: number): number {
	const d = new Date(startSec * 1000);
	d.setUTCMonth(d.getUTCMonth() + n);
	return Math.floor(d.getTime() / 1000);
}

function makeSchedule(overrides: Record<string, unknown> = {}) {
	return {
		id: 'sub_sched_1',
		end_behavior: 'release' as const,
		phases: [
			{
				start_date: START,
				end_date: plusMonths(START, 1),
				items: [{ price: 'price_x4' }],
			},
		],
		...overrides,
	};
}

function boundedSchedule(id = 'sub_sched_1', installments = 4) {
	return {
		id,
		end_behavior: 'cancel' as const,
		phases: [
			{
				start_date: START,
				end_date: plusMonths(START, installments),
				items: [{ price: 'price_x4' }],
			},
		],
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('ensureSubscriptionSchedule', () => {
	it('reconfigure un schedule non borné avec duration + cancel (jamais iterations)', async () => {
		schedulesRetrieve.mockResolvedValue(makeSchedule());
		schedulesUpdate.mockResolvedValue(boundedSchedule('sub_sched_1', 4));

		const id = await ensureSubscriptionSchedule({
			subscriptionId: 'sub_1',
			priceId: 'price_x4',
			installments: 4,
			existingScheduleId: 'sub_sched_1',
		});

		expect(id).toBe('sub_sched_1');
		expect(schedulesUpdate).toHaveBeenCalledTimes(1);

		const [scheduleId, params] = schedulesUpdate.mock.calls[0];
		expect(scheduleId).toBe('sub_sched_1');
		expect(params.end_behavior).toBe('cancel');

		const phase = params.phases[0];
		expect(phase.duration).toEqual({ interval: 'month', interval_count: 4 });
		expect(phase.start_date).toBe(START);
		// Régression garde-fou : le paramètre supprimé par Stripe ne doit jamais repartir.
		expect(phase).not.toHaveProperty('iterations');
	});

	it('ne touche pas un schedule déjà borné (cancel + durée ≥ N mois)', async () => {
		schedulesRetrieve.mockResolvedValue(boundedSchedule('sub_sched_1', 4));

		const id = await ensureSubscriptionSchedule({
			subscriptionId: 'sub_1',
			priceId: 'price_x4',
			installments: 4,
			existingScheduleId: 'sub_sched_1',
		});

		expect(id).toBe('sub_sched_1');
		expect(schedulesUpdate).not.toHaveBeenCalled();
	});

	it('throw si le schedule reste non borné après update (échec silencieux → dur)', async () => {
		schedulesRetrieve.mockResolvedValue(makeSchedule());
		// Stripe renvoie encore release → configuration ratée.
		schedulesUpdate.mockResolvedValue(makeSchedule({ end_behavior: 'release' }));

		await expect(
			ensureSubscriptionSchedule({
				subscriptionId: 'sub_1',
				priceId: 'price_x4',
				installments: 4,
				existingScheduleId: 'sub_sched_1',
			}),
		).rejects.toThrow(/non borné/);
	});

	it('crée le schedule from_subscription quand aucun n’existe encore', async () => {
		subscriptionsRetrieve.mockResolvedValue({ schedule: null });
		schedulesCreate.mockResolvedValue({ id: 'sub_sched_new' });
		schedulesRetrieve.mockResolvedValue(makeSchedule({ id: 'sub_sched_new' }));
		schedulesUpdate.mockResolvedValue(boundedSchedule('sub_sched_new', 6));

		const id = await ensureSubscriptionSchedule({
			subscriptionId: 'sub_1',
			priceId: 'price_x6',
			installments: 6,
			existingScheduleId: null,
		});

		expect(schedulesCreate).toHaveBeenCalledWith({ from_subscription: 'sub_1' });
		expect(id).toBe('sub_sched_new');
		expect(schedulesUpdate.mock.calls[0][1].phases[0].duration).toEqual({
			interval: 'month',
			interval_count: 6,
		});
	});

	it('réutilise le schedule déjà porté par la souscription (pas de doublon)', async () => {
		subscriptionsRetrieve.mockResolvedValue({ schedule: { id: 'sub_sched_existing' } });
		schedulesRetrieve.mockResolvedValue(boundedSchedule('sub_sched_existing', 2));

		const id = await ensureSubscriptionSchedule({
			subscriptionId: 'sub_1',
			priceId: 'price_x2',
			installments: 2,
			existingScheduleId: null,
		});

		expect(schedulesCreate).not.toHaveBeenCalled();
		expect(schedulesRetrieve).toHaveBeenCalledWith('sub_sched_existing');
		expect(id).toBe('sub_sched_existing');
	});
});
