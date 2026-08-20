import type Stripe from 'stripe';

/** Unix timestamp Stripe → Date UTC. */
export function stripeUnixToDate(unix: number | null | undefined): Date | null {
	if (unix == null || !Number.isFinite(unix)) return null;
	return new Date(unix * 1000);
}

/** Min `current_period_end` among subscription items (Stripe billing period anchor). */
export function currentPeriodEndFromSubscription(
	subscription: Stripe.Subscription,
): Date | null {
	const items = subscription.items?.data ?? [];
	if (items.length === 0) return null;

	const ends = items
		.map((item) => item.current_period_end)
		.filter((value): value is number => Number.isFinite(value));

	if (ends.length === 0) return null;
	return stripeUnixToDate(Math.min(...ends));
}

/** Dernière phase du schedule → date de fin d’abonnement. */
export function subscriptionEndsAtFromSchedule(
	schedule: Stripe.SubscriptionSchedule | null | undefined,
): Date | null {
	const lastPhase = schedule?.phases?.at(-1);
	if (!lastPhase?.end_date) return null;
	return stripeUnixToDate(lastPhase.end_date);
}

/** Échéance d’une facture : due_date > next_payment_attempt > period_end. */
export function dueDateFromInvoice(invoice: Stripe.Invoice | null | undefined): Date | null {
	if (!invoice) return null;
	if (invoice.due_date) return stripeUnixToDate(invoice.due_date);
	if (invoice.next_payment_attempt) return stripeUnixToDate(invoice.next_payment_attempt);
	if (invoice.period_end) return stripeUnixToDate(invoice.period_end);
	return null;
}

export type SubscriptionDateSnapshot = {
	currentPeriodEnd: Date | null;
	subscriptionEndsAt: Date | null;
	stripeScheduleEndBehavior: string | null;
	previewDueAt: Date | null;
};

/** Extrait les dates persistables depuis abo + schedule + preview invoice. */
export function extractSubscriptionDates(input: {
	subscription: Stripe.Subscription;
	schedule?: Stripe.SubscriptionSchedule | null;
	previewInvoice?: Stripe.Invoice | null;
}): SubscriptionDateSnapshot {
	const currentPeriodEnd = currentPeriodEndFromSubscription(input.subscription);
	const scheduleEnd = subscriptionEndsAtFromSchedule(input.schedule);
	const cancelAt = stripeUnixToDate(input.subscription.cancel_at);
	const subscriptionEndsAt = scheduleEnd ?? cancelAt;
	const previewDueAt = dueDateFromInvoice(input.previewInvoice);

	return {
		currentPeriodEnd,
		subscriptionEndsAt,
		stripeScheduleEndBehavior: input.schedule?.end_behavior ?? null,
		previewDueAt,
	};
}

/** Prochaine échéance : factures ouvertes/échouées > preview > current_period_end. */
export function resolveNextInstallmentDueAt(input: {
	openOrFailedDueAts: Array<Date | null | undefined>;
	previewDueAt?: Date | null;
	currentPeriodEnd?: Date | null;
	installmentsPaid: number;
	installmentsTotal: number;
	collectionStatus: string;
}): Date | null {
	if (input.installmentsPaid >= input.installmentsTotal && input.installmentsPaid > 0) {
		return null;
	}
	if (input.collectionStatus === 'canceled' || input.collectionStatus === 'refunded') {
		return null;
	}

	const fromPayments = input.openOrFailedDueAts
		.filter((value): value is Date => value instanceof Date)
		.sort((a, b) => a.getTime() - b.getTime())[0];

	if (fromPayments) return fromPayments;
	if (input.previewDueAt) return input.previewDueAt;
	if (input.currentPeriodEnd) return input.currentPeriodEnd;
	return null;
}

export function addUtcMonths(date: Date, months: number): Date {
	const result = new Date(date);
	result.setUTCMonth(result.getUTCMonth() + months);
	return result;
}

/**
 * Projette les dates des échéances futures (intervalle mensuel) à partir de l’ancre Stripe.
 * `anchorInstallment` = numéro de la première échéance non payée couverte par l’ancre.
 */
export function projectFutureInstallmentDueDates(input: {
	anchorDueAt: Date;
	anchorInstallment: number;
	installmentsTotal: number;
}): Map<number, Date> {
	const map = new Map<number, Date>();
	for (let n = input.anchorInstallment; n <= input.installmentsTotal; n++) {
		const offset = n - input.anchorInstallment;
		map.set(n, addUtcMonths(input.anchorDueAt, offset));
	}
	return map;
}
