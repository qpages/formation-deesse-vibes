import { generateToken, hashToken } from '../crypto';
import { getEnv } from '../env';
import { getPrisma } from '../prisma';
import { sendMagicLinkEmail } from '../services/brevo';
import { findEnrollmentByEmail } from './queries';

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
