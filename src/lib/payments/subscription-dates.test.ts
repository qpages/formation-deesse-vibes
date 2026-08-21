import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
	addUtcMonths,
	currentPeriodEndFromSubscription,
	dueDateFromInvoice,
	extractSubscriptionDates,
	projectFutureInstallmentDueDates,
	resolveNextInstallmentDueAt,
	stripeUnixToDate,
	subscriptionEndsAtFromSchedule,
} from './subscription-dates';

describe('stripeUnixToDate', () => {
	it('convertit un timestamp Unix', () => {
		expect(stripeUnixToDate(1_700_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
	});
});

describe('currentPeriodEndFromSubscription', () => {
	it('prend le min current_period_end des items', () => {
		const subscription = {
			items: {
				data: [{ current_period_end: 1_800_000_000 }, { current_period_end: 1_700_000_000 }],
			},
		} as Stripe.Subscription;

		expect(currentPeriodEndFromSubscription(subscription)?.toISOString()).toBe(
			'2023-11-14T22:13:20.000Z',
		);
	});
});

describe('subscriptionEndsAtFromSchedule', () => {
	it('utilise end_date de la dernière phase', () => {
		const schedule = {
			phases: [{ end_date: 1_700_000_000 }, { end_date: 1_900_000_000 }],
		} as Stripe.SubscriptionSchedule;

		expect(subscriptionEndsAtFromSchedule(schedule)?.toISOString()).toBe(
			'2030-03-17T17:46:40.000Z',
		);
	});
});

describe('dueDateFromInvoice', () => {
	it('priorise due_date puis next_payment_attempt puis period_end', () => {
		expect(
			dueDateFromInvoice({
				due_date: 1_800_000_000,
				next_payment_attempt: 1_700_000_000,
				period_end: 1_600_000_000,
			} as Stripe.Invoice)?.getTime(),
		).toBe(1_800_000_000 * 1000);

		expect(
			dueDateFromInvoice({
				next_payment_attempt: 1_700_000_000,
				period_end: 1_600_000_000,
			} as Stripe.Invoice)?.getTime(),
		).toBe(1_700_000_000 * 1000);
	});
});

describe('extractSubscriptionDates', () => {
	it('agrège abo, schedule et preview', () => {
		const snapshot = extractSubscriptionDates({
			subscription: {
				items: { data: [{ current_period_end: 1_800_000_000 }] },
				cancel_at: null,
			} as Stripe.Subscription,
			schedule: {
				end_behavior: 'cancel',
				phases: [{ end_date: 1_900_000_000 }],
			} as Stripe.SubscriptionSchedule,
			previewInvoice: { period_end: 1_800_000_000 } as Stripe.Invoice,
		});

		expect(snapshot.currentPeriodEnd?.getTime()).toBe(1_800_000_000 * 1000);
		expect(snapshot.subscriptionEndsAt?.getTime()).toBe(1_900_000_000 * 1000);
		expect(snapshot.stripeScheduleEndBehavior).toBe('cancel');
		expect(snapshot.previewDueAt?.getTime()).toBe(1_800_000_000 * 1000);
	});
});

describe('resolveNextInstallmentDueAt', () => {
	const base = {
		installmentsPaid: 1,
		installmentsTotal: 4,
		collectionStatus: 'current',
	};

	it('priorise les échéances ouvertes', () => {
		const open = new Date('2026-09-01T00:00:00Z');
		const result = resolveNextInstallmentDueAt({
			...base,
			openOrFailedDueAts: [open],
			previewDueAt: new Date('2026-08-01T00:00:00Z'),
			currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
		});
		expect(result).toEqual(open);
	});

	it('fallback preview puis currentPeriodEnd', () => {
		const preview = new Date('2026-08-15T00:00:00Z');
		expect(
			resolveNextInstallmentDueAt({
				...base,
				openOrFailedDueAts: [],
				previewDueAt: preview,
				currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
			}),
		).toEqual(preview);

		const periodEnd = new Date('2026-07-01T00:00:00Z');
		expect(
			resolveNextInstallmentDueAt({
				...base,
				openOrFailedDueAts: [],
				previewDueAt: null,
				currentPeriodEnd: periodEnd,
			}),
		).toEqual(periodEnd);
	});

	it('null si entièrement payé ou remboursé', () => {
		expect(
			resolveNextInstallmentDueAt({
				...base,
				installmentsPaid: 4,
				openOrFailedDueAts: [],
				currentPeriodEnd: new Date(),
			}),
		).toBeNull();

		expect(
			resolveNextInstallmentDueAt({
				...base,
				collectionStatus: 'refunded',
				openOrFailedDueAts: [],
				currentPeriodEnd: new Date(),
			}),
		).toBeNull();
	});
});

describe('projectFutureInstallmentDueDates', () => {
	it('projette mensuellement à partir de l’ancre', () => {
		const anchor = new Date('2026-01-15T00:00:00Z');
		const map = projectFutureInstallmentDueDates({
			anchorDueAt: anchor,
			anchorInstallment: 2,
			installmentsTotal: 4,
		});

		expect(map.get(2)?.toISOString()).toBe(anchor.toISOString());
		expect(map.get(3)?.toISOString()).toBe(addUtcMonths(anchor, 1).toISOString());
		expect(map.get(4)?.toISOString()).toBe(addUtcMonths(anchor, 2).toISOString());
	});
});
