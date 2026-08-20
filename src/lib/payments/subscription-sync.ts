import type Stripe from 'stripe';
import { getPrisma } from '../prisma';
import {
	findEnrollmentById,
	findEnrollmentByScheduleOrSubscription,
	findEnrollmentBySubscriptionId,
} from '../enrollment';
import {
	createPreviewInvoice,
	listSubscriptionInvoices,
	retrieveSubscription,
	retrieveSubscriptionSchedule,
} from '../stripe';
import { syncStripeInvoice, recomputeEnrollmentCollectionState } from './invoice-sync';
import { extractSubscriptionDates } from './subscription-dates';
import { stripeId } from './stripe-id';
import { mapSubscriptionStatus } from './stripe-status';

async function resolveScheduleId(
	subscription: Stripe.Subscription,
	enrollmentScheduleId?: string | null,
): Promise<string | undefined> {
	return (
		stripeId(subscription.schedule) ??
		enrollmentScheduleId ??
		undefined
	);
}

/** Sync dates Stripe (période, fin abo, preview) sur l’enrollment. */
export async function syncEnrollmentSubscriptionDates(enrollmentId: string) {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment?.stripeSubscriptionId) {
		return { ok: false as const, reason: 'no_subscription' };
	}

	const subscription = await retrieveSubscription(enrollment.stripeSubscriptionId);
	const scheduleId = await resolveScheduleId(subscription, enrollment.stripeScheduleId);

	let schedule: Stripe.SubscriptionSchedule | null = null;
	if (scheduleId) {
		try {
			schedule = await retrieveSubscriptionSchedule(scheduleId);
		} catch (error) {
			console.warn('[payments] retrieve subscription schedule', scheduleId, error);
		}
	}

	let previewInvoice: Stripe.Invoice | null = null;
	if (subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired') {
		try {
			previewInvoice = await createPreviewInvoice({
				subscriptionId: subscription.id,
				scheduleId: schedule?.id,
			});
		} catch (error) {
			console.warn('[payments] preview invoice', subscription.id, error);
		}
	}

	const dates = extractSubscriptionDates({ subscription, schedule, previewInvoice });

	await getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			currentPeriodEnd: dates.currentPeriodEnd,
			subscriptionEndsAt: dates.subscriptionEndsAt,
			stripeScheduleEndBehavior: dates.stripeScheduleEndBehavior,
			subscriptionStatus: mapSubscriptionStatus(subscription.status),
			...(scheduleId ? { stripeScheduleId: scheduleId } : {}),
		},
	});

	await recomputeEnrollmentCollectionState(enrollmentId, { previewDueAt: dates.previewDueAt });

	return { ok: true as const, enrollmentId };
}

export async function syncSubscriptionState(subscription: Stripe.Subscription) {
	const subscriptionId = subscription.id;
	const prisma = getPrisma();
	const enrollment = await findEnrollmentBySubscriptionId(subscriptionId);

	if (!enrollment) {
		const metaId = subscription.metadata?.enrollmentId;
		if (!metaId) return { ok: false as const, reason: 'enrollment_not_found' };
		const byMeta = await findEnrollmentById(metaId);
		if (!byMeta) return { ok: false as const, reason: 'enrollment_not_found' };
		await prisma.enrollment.update({
			where: { id: byMeta.id },
			data: {
				stripeSubscriptionId: subscriptionId,
				subscriptionStatus: mapSubscriptionStatus(subscription.status),
			},
		});
		await syncEnrollmentSubscriptionDates(byMeta.id);
		return { ok: true as const, enrollmentId: byMeta.id };
	}

	await syncEnrollmentSubscriptionDates(enrollment.id);
	return { ok: true as const, enrollmentId: enrollment.id };
}

export async function syncSubscriptionScheduleState(schedule: Stripe.SubscriptionSchedule) {
	const subscriptionId = stripeId(schedule.subscription);
	if (!subscriptionId) {
		return { ok: false as const, reason: 'no_subscription' };
	}

	const enrollment = await findEnrollmentByScheduleOrSubscription(schedule.id, subscriptionId);
	if (!enrollment) {
		return { ok: false as const, reason: 'enrollment_not_found' };
	}

	await getPrisma().enrollment.update({
		where: { id: enrollment.id },
		data: { stripeScheduleId: schedule.id },
	});

	return syncEnrollmentSubscriptionDates(enrollment.id);
}

/**
 * Schedule Stripe terminé → sync statut abo (souvent canceled) + clear prochaine échéance.
 * “Soldé” métier = collectionStatus / Payments, pas subscriptionStatus.
 */
export async function markSubscriptionScheduleCompleted(schedule: Stripe.SubscriptionSchedule) {
	const subscriptionId = stripeId(schedule.subscription);

	if (!subscriptionId) {
		return { ok: false as const, reason: 'no_subscription' };
	}

	const enrollment = await findEnrollmentByScheduleOrSubscription(schedule.id, subscriptionId);

	if (!enrollment) {
		return { ok: false as const, reason: 'enrollment_not_found' };
	}

	const subscription = await retrieveSubscription(subscriptionId);
	const dates = extractSubscriptionDates({ subscription, schedule });

	await getPrisma().enrollment.update({
		where: { id: enrollment.id },
		data: {
			subscriptionStatus: mapSubscriptionStatus(subscription.status),
			currentPeriodEnd: dates.currentPeriodEnd,
			subscriptionEndsAt: dates.subscriptionEndsAt,
			stripeScheduleEndBehavior: dates.stripeScheduleEndBehavior,
			nextInstallmentDueAt: null,
		},
	});

	return { ok: true as const, enrollmentId: enrollment.id };
}

export async function syncAllSubscriptionInvoices(enrollmentId: string) {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment?.stripeSubscriptionId) {
		return { ok: false as const, reason: 'no_subscription' };
	}

	const invoices = await listSubscriptionInvoices(enrollment.stripeSubscriptionId);
	for (const invoice of invoices.data) {
		await syncStripeInvoice(invoice, { enrollmentId });
	}

	return syncEnrollmentSubscriptionDates(enrollmentId);
}
