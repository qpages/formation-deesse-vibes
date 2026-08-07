import type {
	ContractStatus,
	Enrollment,
	PaymentPlanId,
	YousignRequestStatus,
} from '../../generated/prisma/client';
import { generateToken, hashToken } from '../crypto';
import { isAwaitingNda } from '../enrollment-gates';
import { getEnv } from '../env';
import { getPaymentPlan } from '../payment-plans';
import { getPrisma } from '../prisma';
import { getSignatureLink } from '../yousign';
import { sendMagicLinkEmail } from './resend';
import {
	findEnrollmentByEmail,
	withUser,
} from './enrollment-queries';

export type { EnrollmentWithUser } from './enrollment-queries';
export {
	findEnrollmentByCheckoutSession,
	findEnrollmentByEmail,
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	findEnrollmentByScheduleId,
	findEnrollmentByScheduleOrSubscription,
	findEnrollmentBySubscriptionId,
	findEnrollmentByYousignRequestId,
	findEnrollmentByYousignRequestOrExternalId,
	findEnrollmentForAccessPolicy,
	findEnrollmentIdByStripeInvoiceId,
} from './enrollment-queries';
export {
	markProviderEventFailed,
	markProviderEventIgnored,
	markProviderEventProcessed,
	purgeOldWebhookPayloads,
	recordProviderEvent,
} from './provider-events';

const NDA_RESEND_COOLDOWN_MS = 15 * 60 * 1000;
const NDA_RESEND_MAX_PER_DAY = 5;

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
	if (!isAwaitingNda(enrollment)) {
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

/** Clear Yousign ids without calling provider cancel (recreate NDA). */
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
