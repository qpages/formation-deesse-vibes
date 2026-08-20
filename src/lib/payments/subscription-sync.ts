import type Stripe from 'stripe';
import { getPrisma } from '../prisma';
import {
	findEnrollmentById,
	findEnrollmentByScheduleOrSubscription,
	findEnrollmentBySubscriptionId,
} from '../enrollment';
import { listSubscriptionInvoices, retrieveSubscription } from '../stripe';
import { syncStripeInvoice } from './invoice-sync';
import { stripeId } from './stripe-id';
import { mapSubscriptionStatus } from './stripe-status';

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
		return { ok: true as const, enrollmentId: byMeta.id };
	}

	const scheduleId =
		typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id;

	await prisma.enrollment.update({
		where: { id: enrollment.id },
		data: {
			subscriptionStatus: mapSubscriptionStatus(subscription.status),
			...(scheduleId ? { stripeScheduleId: scheduleId } : {}),
		},
	});

	return { ok: true as const, enrollmentId: enrollment.id };
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

	const prisma = getPrisma();
	const enrollment = await findEnrollmentByScheduleOrSubscription(schedule.id, subscriptionId);

	if (!enrollment) {
		return { ok: false as const, reason: 'enrollment_not_found' };
	}

	const subscription = await retrieveSubscription(subscriptionId);

	await prisma.enrollment.update({
		where: { id: enrollment.id },
		data: {
			subscriptionStatus: mapSubscriptionStatus(subscription.status),
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

	const subscription = await retrieveSubscription(enrollment.stripeSubscriptionId);
	await syncSubscriptionState(subscription);

	return { ok: true as const, enrollmentId };
}
