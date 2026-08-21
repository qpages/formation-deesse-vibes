import type { Enrollment } from '../../generated/prisma/client';
import { isAwaitingNda } from '../enrollment-gates';
import { getPrisma } from '../prisma';
import {
	resolveExternalRequestId,
	resolveExternalSignerId,
	resolveNdaProvider,
} from '../signature/nda-request';
import { resolveSignatureProviderForEnrollment } from '../signature/providers';
import type { SignSurface } from '../signature/types';
import { withUser, type EnrollmentWithUser } from './queries';

const NDA_RESEND_COOLDOWN_MS = 15 * 60 * 1000;
const NDA_RESEND_MAX_PER_DAY = 5;

export async function canResendNda(
	enrollment: EnrollmentWithUser,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (!isAwaitingNda(enrollment)) {
		return {
			ok: false,
			reason: 'Le contrat de confidentialité n’est pas en attente de signature.',
		};
	}
	if (!resolveExternalRequestId(enrollment)) {
		return { ok: false, reason: 'Aucune demande de signature associée.' };
	}
	if (resolveNdaProvider(enrollment) === 'docuseal') {
		return { ok: false, reason: 'Signature intégrée sur la page — pas de renvoi par e-mail.' };
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

	return getPrisma().$transaction(async (tx) => {
		await tx.ndaRequest.updateMany({
			where: { enrollmentId: enrollment.id },
			data: { lastError: null, lastErrorAt: null },
		});
		return tx.enrollment.update({
			where: { id: enrollment.id },
			data: {
				ndaLastResendAt: new Date(),
				ndaResendDay: dayStart,
				ndaResendCount: sameDay ? enrollment.ndaResendCount + 1 : 1,
			},
			...withUser,
		});
	});
}

type NdaRequestMetadata = { embed_src?: string };

export async function resolveNdaSignSurface(
	enrollment: EnrollmentWithUser,
): Promise<SignSurface | null> {
	const requestId = resolveExternalRequestId(enrollment);
	const signerId = resolveExternalSignerId(enrollment);
	if (!requestId || !signerId) return null;

	if (enrollment.ndaRequest?.signKind === 'embed') {
		const metadata = enrollment.ndaRequest.metadata as NdaRequestMetadata | null;
		const src = metadata?.embed_src;
		if (src) {
			return {
				kind: 'embed',
				provider: resolveNdaProvider(enrollment),
				src,
				email: enrollment.user.email,
			};
		}
	}

	try {
		return await resolveSignatureProviderForEnrollment(enrollment).getSignSurface({
			requestId,
			signerId,
			email: enrollment.user.email,
		});
	} catch {
		return null;
	}
}

function startOfUtcDay(d: Date) {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
