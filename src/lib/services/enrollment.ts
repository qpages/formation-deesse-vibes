import type {
	ContractStatus,
	Enrollment,
	PaymentPlanId,
	YousignRequestStatus,
	YousignSignerStatus,
} from '../../generated/prisma/client';
import { generateToken, hashToken } from '../crypto';
import { isAwaitingNda } from '../enrollment-gates';
import { getEnv } from '../env';
import { getPaymentPlan } from '../payment-plans';
import { getPrisma } from '../prisma';
import { getSignaturePort } from '../signature/factory';
import { sendMagicLinkEmail } from './brevo';
import { findEnrollmentByEmail, withUser } from './enrollment-queries';

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
	findEnrollmentIdByPaymentIntentId,
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
		yousignStatus?: YousignRequestStatus;
		contractStatus?: ContractStatus;
		yousignRequestId?: string | null;
		yousignSignerId?: string | null;
		yousignSignerStatus?: YousignSignerStatus | null;
		signatureLinkExpiresAt?: Date | null;
		ndaNotifiedAt?: Date | null;
		ndaLinkOpenedAt?: Date | null;
		ndaSignedAt?: Date | null;
		ndaDeliveryFailedAt?: Date | null;
		yousignLastError?: string | null;
		yousignLastErrorAt?: Date | null;
	},
) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			...(data.yousignStatus !== undefined ? { yousignStatus: data.yousignStatus } : {}),
			...(data.contractStatus ? { contractStatus: data.contractStatus } : {}),
			...(data.yousignRequestId !== undefined ? { yousignRequestId: data.yousignRequestId } : {}),
			...(data.yousignSignerId !== undefined ? { yousignSignerId: data.yousignSignerId } : {}),
			...(data.yousignSignerStatus !== undefined
				? { yousignSignerStatus: data.yousignSignerStatus }
				: {}),
			...(data.signatureLinkExpiresAt !== undefined
				? { signatureLinkExpiresAt: data.signatureLinkExpiresAt }
				: {}),
			...(data.ndaNotifiedAt !== undefined ? { ndaNotifiedAt: data.ndaNotifiedAt } : {}),
			...(data.ndaLinkOpenedAt !== undefined ? { ndaLinkOpenedAt: data.ndaLinkOpenedAt } : {}),
			...(data.ndaSignedAt !== undefined ? { ndaSignedAt: data.ndaSignedAt } : {}),
			...(data.ndaDeliveryFailedAt !== undefined
				? { ndaDeliveryFailedAt: data.ndaDeliveryFailedAt }
				: {}),
			...(data.yousignLastError !== undefined ? { yousignLastError: data.yousignLastError } : {}),
			...(data.yousignLastErrorAt !== undefined
				? { yousignLastErrorAt: data.yousignLastErrorAt }
				: {}),
		},
		...withUser,
	});
}

/** Max longueur stockée pour une erreur Yousign (colonne TEXT, on borne l'affichage admin). */
const YOUSIGN_ERROR_MAX_LEN = 1000;

/** Persiste la dernière erreur Yousign pour diagnostic admin. Ne throw jamais. */
export async function recordYousignError(enrollmentId: string, message: string) {
	try {
		const prisma = getPrisma();
		const data = {
			yousignLastError: message.slice(0, YOUSIGN_ERROR_MAX_LEN),
			yousignLastErrorAt: new Date(),
		};
		await prisma.enrollment.update({
			where: { id: enrollmentId },
			data,
		});
		// Création jamais aboutie : pending + erreur ≠ « à envoyer ».
		await prisma.enrollment.updateMany({
			where: { id: enrollmentId, contractStatus: 'pending' },
			data: { contractStatus: 'error' },
		});
	} catch (error) {
		console.error('[recordYousignError] persist failed', error);
	}
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
			yousignSignerStatus: null,
			signatureLinkExpiresAt: null,
			ndaNotifiedAt: null,
			ndaLinkOpenedAt: null,
			ndaSignedAt: null,
			ndaDeliveryFailedAt: null,
			yousignLastError: null,
			yousignLastErrorAt: null,
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

/** "camille" / "MArtin" / "jean-pierre" → "Camille" / "Martin" / "Jean-Pierre" */
function normalizePersonName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}

export async function createPendingEnrollment(input: {
	email: string;
	firstName: string;
	lastName: string;
	paymentPlan: PaymentPlanId;
	consentCgv: boolean;
	consentNda: boolean;
	consentPrivacy: boolean;
	consentWithdrawalWaiver: boolean;
}) {
	const email = input.email.trim().toLowerCase();
	const firstName = normalizePersonName(input.firstName);
	const lastName = normalizePersonName(input.lastName);
	const prisma = getPrisma();

	const existingPaid = await prisma.enrollment.findFirst({
		where: {
			user: { email },
			OR: [{ collectionStatus: { not: 'pending' } }, { accessStatus: { not: 'not_eligible' } }],
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
		consentWithdrawalWaiverAt: input.consentWithdrawalWaiver ? now : null,
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
		return { ok: true as const, sent: false as const };
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

	return { ok: true as const, sent: true as const };
}

export type MagicLinkLookup =
	| { status: 'unused'; enrollmentId: string }
	| { status: 'used'; enrollmentId: string }
	| { status: 'invalid' };

function toMagicLinkLookup(
	link: {
		usedAt: Date | null;
		expiresAt: Date;
		enrollmentId: string;
	} | null,
): MagicLinkLookup {
	if (!link) return { status: 'invalid' };
	if (link.usedAt) return { status: 'used', enrollmentId: link.enrollmentId };
	if (link.expiresAt < new Date()) return { status: 'invalid' };
	return { status: 'unused', enrollmentId: link.enrollmentId };
}

/** Lookup without marking usedAt (prefetch-safe). */
export async function peekMagicLink(token: string): Promise<MagicLinkLookup> {
	const link = await getPrisma().magicLink.findUnique({
		where: { tokenHash: hashToken(token) },
	});
	return toMagicLinkLookup(link);
}

/** Consume unused valid token once (updateMany + usedAt: null). */
export async function consumeMagicLink(token: string): Promise<MagicLinkLookup> {
	const tokenHash = hashToken(token);
	const prisma = getPrisma();
	const now = new Date();
	const consumed = await prisma.magicLink.updateMany({
		where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
		data: { usedAt: now },
	});
	if (consumed.count === 1) {
		const link = await prisma.magicLink.findUnique({ where: { tokenHash } });
		return link ? { status: 'unused', enrollmentId: link.enrollmentId } : { status: 'invalid' };
	}
	return peekMagicLink(token);
}

export async function canResendNda(
	enrollment: Enrollment,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (!isAwaitingNda(enrollment)) {
		return { ok: false, reason: 'Le contrat de confidentialité n’est pas en attente de signature.' };
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
			yousignLastError: null,
			yousignLastErrorAt: null,
		},
		...withUser,
	});
}

export async function resolveNdaSignUrl(enrollment: Enrollment): Promise<string | null> {
	if (!enrollment.yousignRequestId || !enrollment.yousignSignerId) return null;
	try {
		return await getSignaturePort().getSignSurface({
			requestId: enrollment.yousignRequestId,
			signerId: enrollment.yousignSignerId,
		});
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
			yousignSignerStatus: null,
			signatureLinkExpiresAt: null,
			ndaNotifiedAt: null,
			ndaLinkOpenedAt: null,
			ndaSignedAt: null,
			ndaDeliveryFailedAt: null,
			yousignLastError: null,
			yousignLastErrorAt: null,
			contractStatus: 'pending',
		},
		...withUser,
	});
}
