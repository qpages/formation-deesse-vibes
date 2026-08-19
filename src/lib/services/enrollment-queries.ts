import type { Enrollment, NdaRequest, SignatureProvider, User } from '../../generated/prisma/client';
import { getPrisma } from '../prisma';

export type EnrollmentWithUser = Enrollment & { user: User; ndaRequest?: NdaRequest | null };

export const withUser = { include: { user: true, ndaRequest: true } } as const;

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
	return findEnrollmentByExternalRequestId('yousign', requestId);
}

/** Resolve enrollment from Yousign request id, falling back to external_id (= enrollment id). */
export async function findEnrollmentByYousignRequestOrExternalId(
	requestId: string,
	externalId?: string,
) {
	return findEnrollmentByExternalRequestOrEnrollmentId('yousign', requestId, externalId);
}

export async function findEnrollmentByExternalRequestId(
	provider: SignatureProvider,
	requestId: string,
) {
	const prisma = getPrisma();

	const viaNda = await prisma.enrollment.findFirst({
		where: { ndaRequest: { provider, externalRequestId: requestId } },
		...withUser,
	});
	if (viaNda) return viaNda;

	if (provider !== 'yousign') return null;

	return prisma.enrollment.findUnique({
		where: { yousignRequestId: requestId },
		...withUser,
	});
}

export async function findEnrollmentByExternalRequestOrEnrollmentId(
	provider: SignatureProvider,
	requestId: string,
	externalId?: string,
) {
	const prisma = getPrisma();

	return prisma.enrollment.findFirst({
		where: {
			OR: [
				{ ndaRequest: { provider, externalRequestId: requestId } },
				...(provider === 'yousign' ? [{ yousignRequestId: requestId }] : []),
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

/**
 * Résout un enrollment depuis un PaymentIntent Stripe (refund / dispute).
 * L'enrollment porte le PI du 1er paiement ; les échéances suivantes vivent
 * sur les lignes Payment — on couvre les deux.
 */
export async function findEnrollmentIdByPaymentIntentId(paymentIntentId: string) {
	const prisma = getPrisma();

	const enrollment = await prisma.enrollment.findFirst({
		where: { stripePaymentIntentId: paymentIntentId },
		select: { id: true },
	});
	if (enrollment) return enrollment.id;

	const payment = await prisma.payment.findFirst({
		where: { stripePaymentIntentId: paymentIntentId },
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
