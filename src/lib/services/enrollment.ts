import type { Enrollment, EnrollmentStatus } from '../../generated/prisma/client';
import { encryptPayload, generateToken, hashToken } from '../crypto';
import { getPrisma } from '../db';
import { getEnv } from '../env';
import { sendMagicLinkEmail } from './resend';
import { getSignatureLink } from './yousign';

const NDA_RESEND_COOLDOWN_MS = 15 * 60 * 1000;
const NDA_RESEND_MAX_PER_DAY = 5;

export async function findEnrollmentByEmail(email: string) {
	return getPrisma().enrollment.findUnique({
		where: { email: email.trim().toLowerCase() },
	});
}

export async function findEnrollmentById(id: string) {
	return getPrisma().enrollment.findUnique({ where: { id } });
}

export async function findEnrollmentByCheckoutSession(sessionId: string) {
	return getPrisma().enrollment.findUnique({
		where: { stripeCheckoutSessionId: sessionId },
	});
}

export async function createPendingEnrollment(input: {
	email: string;
	firstName: string;
	lastName: string;
	consentCgv: boolean;
	consentNda: boolean;
	consentPrivacy: boolean;
}) {
	const email = input.email.trim().toLowerCase();
	const existing = await findEnrollmentByEmail(email);
	if (existing && existing.status !== 'paiement_en_attente') {
		throw new DuplicateEnrollmentError(email);
	}

	const now = new Date();
	const data = {
		email,
		firstName: input.firstName.trim(),
		lastName: input.lastName.trim(),
		consentCgvAt: input.consentCgv ? now : null,
		consentNdaAt: input.consentNda ? now : null,
		consentPrivacyAt: input.consentPrivacy ? now : null,
		amountCents: getEnv().STRIPE_AMOUNT_CENTS,
		status: 'paiement_en_attente' as const,
	};

	if (existing) {
		return getPrisma().enrollment.update({ where: { id: existing.id }, data });
	}

	return getPrisma().enrollment.create({ data });
}

export class DuplicateEnrollmentError extends Error {
	constructor(email: string) {
		super(`Une inscription existe déjà pour ${email}`);
		this.name = 'DuplicateEnrollmentError';
	}
}

export async function recordProcessedEvent(input: {
	provider: string;
	eventId: string;
	enrollmentId?: string;
	payload: unknown;
}): Promise<{ created: boolean }> {
	const prisma = getPrisma();
	try {
		await prisma.processedEvent.create({
			data: {
				provider: input.provider,
				eventId: input.eventId,
				enrollmentId: input.enrollmentId,
				payloadCipherText: encryptPayload(JSON.stringify(input.payload)),
			},
		});
		return { created: true };
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

/** Libère un event pour permettre un retry Stripe après échec de traitement. */
export async function releaseProcessedEvent(provider: string, eventId: string) {
	await getPrisma().processedEvent.deleteMany({
		where: { provider, eventId },
	});
}

export async function transitionStatus(
	enrollmentId: string,
	from: EnrollmentStatus | EnrollmentStatus[],
	to: EnrollmentStatus,
	extra: Record<string, unknown> = {},
) {
	const prisma = getPrisma();
	const allowed = Array.isArray(from) ? from : [from];
	const result = await prisma.enrollment.updateMany({
		where: { id: enrollmentId, status: { in: allowed } },
		data: { status: to, ...extra },
	});
	return result.count > 0;
}

export async function requestMagicLink(email: string) {
	const enrollment = await findEnrollmentByEmail(email);
	// Réponse uniforme pour ne pas énumérer les comptes
	if (!enrollment || enrollment.status === 'paiement_en_attente') {
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
		to: enrollment.email,
		firstName: enrollment.firstName,
		url,
	});

	return { ok: true as const };
}

export async function consumeMagicLink(token: string) {
	const tokenHash = hashToken(token);
	const prisma = getPrisma();
	const link = await prisma.magicLink.findUnique({
		where: { tokenHash },
		include: { enrollment: true },
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
	if (enrollment.status !== 'nda_envoye' && enrollment.status !== 'paiement_confirme') {
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
	await getPrisma().processedEvent.updateMany({
		where: { createdAt: { lt: cutoff }, payloadCipherText: { not: null } },
		data: { payloadCipherText: null },
	});
}
