import type { Enrollment, User } from '../../generated/prisma/client';
import { getPrisma } from '../prisma';

export type EnrollmentWithUser = Enrollment & { user: User };

export const withUser = { include: { user: true } } as const;

export async function findEnrollmentByEmail(email: string) {
	return getPrisma().enrollment.findFirst({
		where: { user: { email: email.trim().toLowerCase() } },
		orderBy: { createdAt: 'desc' },
		...withUser,
	});
}

export async function findEnrollmentById(id: string) {
	return getPrisma().enrollment.findUnique({ where: { id }, ...withUser });
}

export async function findEnrollmentByIdOrThrow(id: string) {
	return getPrisma().enrollment.findUniqueOrThrow({ where: { id }, ...withUser });
}

export async function findEnrollmentByCheckoutSession(sessionId: string) {
	return getPrisma().enrollment.findUnique({
		where: { stripeCheckoutSessionId: sessionId },
		...withUser,
	});
}

export async function findEnrollmentBySubscriptionId(subscriptionId: string) {
	return getPrisma().enrollment.findUnique({
		where: { stripeSubscriptionId: subscriptionId },
		...withUser,
	});
}

export async function findEnrollmentByScheduleId(scheduleId: string) {
	return getPrisma().enrollment.findFirst({
		where: { stripeScheduleId: scheduleId },
		...withUser,
	});
}

export async function findEnrollmentByScheduleOrSubscription(
	scheduleId: string,
	subscriptionId: string,
) {
	return getPrisma().enrollment.findFirst({
		where: {
			OR: [{ stripeScheduleId: scheduleId }, { stripeSubscriptionId: subscriptionId }],
		},
		...withUser,
	});
}

export async function findEnrollmentByYousignRequestId(requestId: string) {
	return getPrisma().enrollment.findUnique({
		where: { yousignRequestId: requestId },
		...withUser,
	});
}

/** Resolve enrollment from Yousign request id, falling back to external_id (= enrollment id). */
export async function findEnrollmentByYousignRequestOrExternalId(
	requestId: string,
	externalId?: string,
) {
	return getPrisma().enrollment.findFirst({
		where: {
			OR: [
				{ yousignRequestId: requestId },
				...(externalId ? [{ id: externalId }] : []),
			],
		},
		...withUser,
	});
}

export async function findEnrollmentIdByStripeInvoiceId(invoiceId: string) {
	const payment = await getPrisma().payment.findUnique({
		where: { stripeInvoiceId: invoiceId },
		select: { enrollmentId: true },
	});
	return payment?.enrollmentId ?? null;
}

/** Load enrollment + payment statuses for access policy evaluation. */
export async function findEnrollmentForAccessPolicy(enrollmentId: string) {
	return getPrisma().enrollment.findUniqueOrThrow({
		where: { id: enrollmentId },
		include: {
			payments: { select: { status: true } },
			user: true,
		},
	});
}
