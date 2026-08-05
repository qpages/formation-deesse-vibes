import type {
	ContractStatus,
	Enrollment,
	PaymentPlanId,
	User,
	YousignRequestStatus,
} from '../../generated/prisma/client';
import { encryptPayload, generateToken, hashToken } from '../crypto';
import { getPrisma } from '../prisma';
import { getEnv } from '../env';
import { getPaymentPlan } from '../payment-plans';
import { sendMagicLinkEmail } from './resend';
import { getSignatureLink } from '../yousign';

const NDA_RESEND_COOLDOWN_MS = 15 * 60 * 1000;
const NDA_RESEND_MAX_PER_DAY = 5;

export type EnrollmentWithUser = Enrollment & { user: User };

const withUser = { include: { user: true } } as const;

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

export async function attachStripeCheckoutSession(enrollmentId: string, sessionId: string) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: { stripeCheckoutSessionId: sessionId },
		...withUser,
	});
}

export async function updateEnrollmentYousignMirror(
	enrollmentId: string,
	data: {
		yousignStatus: YousignRequestStatus;
		contractStatus?: ContractStatus;
		yousignRequestId?: string | null;
		yousignSignerId?: string | null;
	},
) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			yousignStatus: data.yousignStatus,
			...(data.contractStatus ? { contractStatus: data.contractStatus } : {}),
			...(data.yousignRequestId !== undefined
				? { yousignRequestId: data.yousignRequestId }
				: {}),
			...(data.yousignSignerId !== undefined
				? { yousignSignerId: data.yousignSignerId }
				: {}),
		},
		...withUser,
	});
}

export async function persistNdaProvisioned(
	enrollmentId: string,
	nda: { requestId: string; signerId: string },
) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			yousignRequestId: nda.requestId,
			yousignSignerId: nda.signerId,
			yousignStatus: 'ongoing',
			contractStatus: 'sent',
		},
		...withUser,
	});
}

export async function persistNdaDraftRequestId(enrollmentId: string, requestId: string) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: { yousignRequestId: requestId },
		...withUser,
	});
}

export async function createPendingEnrollment(input: {
	email: string;
	firstName: string;
	lastName: string;
	paymentPlan: PaymentPlanId;
	consentCgv: boolean;
	consentNda: boolean;
	consentPrivacy: boolean;
}) {
	const email = input.email.trim().toLowerCase();
	const firstName = input.firstName.trim();
	const lastName = input.lastName.trim();
	const prisma = getPrisma();

	const existingPaid = await prisma.enrollment.findFirst({
		where: {
			user: { email },
			OR: [
				{ collectionStatus: { not: 'pending' } },
				{ accessStatus: { not: 'not_eligible' } },
			],
		},
	});
	if (existingPaid) {
		throw new DuplicateEnrollmentError(email);
	}

	const user = await prisma.user.upsert({
		where: { email },
		create: { email, firstName, lastName },
		update: { firstName, lastName },
	});

	const existing = await prisma.enrollment.findFirst({
		where: { userId: user.id, collectionStatus: 'pending' },
		orderBy: { createdAt: 'desc' },
	});

	const plan = getPaymentPlan(input.paymentPlan);
	const now = new Date();
	const data = {
		userId: user.id,
		consentCgvAt: input.consentCgv ? now : null,
		consentNdaAt: input.consentNda ? now : null,
		consentPrivacyAt: input.consentPrivacy ? now : null,
		paymentPlan: plan.id,
		installmentsTotal: plan.installments,
		totalAmountCents: plan.totalAmountCents,
		amountCents: plan.installmentAmountCents,
		collectionStatus: 'pending' as const,
		contractStatus: 'pending' as const,
		accessStatus: 'not_eligible' as const,
	};

	if (existing) {
		return prisma.enrollment.update({
			where: { id: existing.id },
			data,
			...withUser,
		});
	}

	return prisma.enrollment.create({ data, ...withUser });
}

export class DuplicateEnrollmentError extends Error {
	constructor(email: string) {
		super(`Une inscription existe déjà pour ${email}`);
		this.name = 'DuplicateEnrollmentError';
	}
}

/** Insert inbox event (status=received). Duplicate unique → created:false. */
export async function recordProviderEvent(input: {
	provider: string;
	providerEventId: string;
	eventType: string;
	enrollmentId?: string;
	payload: unknown;
}): Promise<{ created: boolean; id?: string }> {
	const prisma = getPrisma();
	try {
		const row = await prisma.providerEvent.create({
			data: {
				provider: input.provider,
				providerEventId: input.providerEventId,
				eventType: input.eventType,
				status: 'received',
				enrollmentId: input.enrollmentId,
				payloadCipherText: encryptPayload(JSON.stringify(input.payload)),
			},
		});
		return { created: true, id: row.id };
	} catch (error) {
		if (
			typeof error === 'object' &&
			error &&
			'code' in error &&
			(error as { code: string }).code === 'P2002'
		) {
			return { created: false };
		}
		throw error;
	}
}

export async function markProviderEventProcessed(id: string, enrollmentId?: string | null) {
	await getPrisma().providerEvent.update({
		where: { id },
		data: {
			status: 'processed',
			processedAt: new Date(),
			lastError: null,
			...(enrollmentId ? { enrollmentId } : {}),
		},
	});
}

export async function markProviderEventIgnored(id: string) {
	await getPrisma().providerEvent.update({
		where: { id },
		data: { status: 'ignored', processedAt: new Date(), lastError: null },
	});
}

export async function markProviderEventFailed(id: string, error: string) {
	await getPrisma().providerEvent.update({
		where: { id },
		data: { status: 'failed', lastError: error.slice(0, 2000) },
	});
}

/** @deprecated Use recordProviderEvent */
export const recordProcessedEvent = async (input: {
	provider: string;
	eventId: string;
	enrollmentId?: string;
	payload: unknown;
	eventType?: string;
}) =>
	recordProviderEvent({
		provider: input.provider,
		providerEventId: input.eventId,
		eventType: input.eventType ?? 'unknown',
		enrollmentId: input.enrollmentId,
		payload: input.payload,
	});

export async function requestMagicLink(email: string) {
	const enrollment = await findEnrollmentByEmail(email);
	if (!enrollment || enrollment.collectionStatus === 'pending') {
		return { ok: true as const };
	}

	const token = generateToken();
	const tokenHash = hashToken(token);
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

	await getPrisma().magicLink.create({
		data: {
			enrollmentId: enrollment.id,
			tokenHash,
			expiresAt,
		},
	});

	const url = `${getEnv().PUBLIC_SITE_URL}/?token=${token}`;
	await sendMagicLinkEmail({
		to: enrollment.user.email,
		firstName: enrollment.user.firstName,
		url,
	});

	return { ok: true as const };
}

export async function consumeMagicLink(token: string) {
	const tokenHash = hashToken(token);
	const prisma = getPrisma();
	const link = await prisma.magicLink.findUnique({
		where: { tokenHash },
		include: { enrollment: withUser },
	});

	if (!link || link.usedAt || link.expiresAt < new Date()) {
		return null;
	}

	await prisma.magicLink.update({
		where: { id: link.id },
		data: { usedAt: new Date() },
	});

	return link.enrollment;
}

export async function canResendNda(enrollment: Enrollment): Promise<
	| { ok: true }
	| { ok: false; reason: string }
> {
	const awaiting =
		(enrollment.contractStatus === 'sent' || enrollment.contractStatus === 'pending') &&
		enrollment.collectionStatus !== 'pending' &&
		enrollment.collectionStatus !== 'canceled' &&
		enrollment.accessStatus === 'not_eligible';
	if (!awaiting) {
		return { ok: false, reason: 'Le NDA n’est pas en attente de signature.' };
	}
	if (enrollment.contractStatus === 'signed') {
		return { ok: false, reason: 'Le NDA n’est pas en attente de signature.' };
	}
	if (!enrollment.yousignRequestId) {
		return { ok: false, reason: 'Aucune demande Yousign associée.' };
	}

	const now = Date.now();
	if (
		enrollment.ndaLastResendAt &&
		now - enrollment.ndaLastResendAt.getTime() < NDA_RESEND_COOLDOWN_MS
	) {
		return { ok: false, reason: 'Veuillez patienter 15 minutes avant un nouvel envoi.' };
	}

	const dayStart = startOfUtcDay(new Date());
	const countToday =
		enrollment.ndaResendDay && enrollment.ndaResendDay.getTime() === dayStart.getTime()
			? enrollment.ndaResendCount
			: 0;

	if (countToday >= NDA_RESEND_MAX_PER_DAY) {
		return { ok: false, reason: 'Limite quotidienne de renvois atteinte (5/jour).' };
	}

	return { ok: true };
}

export async function markNdaResent(enrollment: Enrollment) {
	const dayStart = startOfUtcDay(new Date());
	const sameDay =
		enrollment.ndaResendDay && enrollment.ndaResendDay.getTime() === dayStart.getTime();

	return getPrisma().enrollment.update({
		where: { id: enrollment.id },
		data: {
			ndaLastResendAt: new Date(),
			ndaResendDay: dayStart,
			ndaResendCount: sameDay ? enrollment.ndaResendCount + 1 : 1,
			yousignStatus: 'ongoing',
		},
		...withUser,
	});
}

export async function resolveNdaSignUrl(enrollment: Enrollment): Promise<string | null> {
	if (!enrollment.yousignRequestId || !enrollment.yousignSignerId) return null;
	try {
		return await getSignatureLink(enrollment.yousignRequestId, enrollment.yousignSignerId);
	} catch {
		return null;
	}
}

function startOfUtcDay(d: Date) {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Purge des payloads webhook > 30 jours */
export async function purgeOldWebhookPayloads() {
	const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	await getPrisma().providerEvent.updateMany({
		where: { receivedAt: { lt: cutoff }, payloadCipherText: { not: null } },
		data: { payloadCipherText: null },
	});
}

/** Clear Yousign ids without calling provider cancel (admin delete_nda). */
export async function clearNdaFields(enrollmentId: string) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			yousignRequestId: null,
			yousignSignerId: null,
			yousignStatus: null,
			contractStatus: 'pending',
		},
		...withUser,
	});
}

export async function markEnrollmentRefunded(enrollmentId: string) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			collectionStatus: 'refunded',
			accessStatus: 'revoked',
			accessRevokedAt: new Date(),
		},
		...withUser,
	});
}

export async function markEnrollmentAccessRevoked(enrollmentId: string) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			accessStatus: 'revoked',
			accessRevokedAt: new Date(),
		},
		...withUser,
	});
}
