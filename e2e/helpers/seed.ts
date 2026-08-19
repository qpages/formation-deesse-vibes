import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient } from '../../src/generated/prisma/client';

config();

let prisma: PrismaClient | undefined;

function getPrisma() {
	if (!prisma) {
		const connectionString = process.env.DEV_DATABASE_URL?.trim();
		if (!connectionString) {
			throw new Error('DEV_DATABASE_URL is required for e2e seeds');
		}
		prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
	}
	return prisma;
}

function hashToken(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

async function createEnrollmentSessionToken(enrollmentId: string) {
	const secret = process.env.SESSION_SECRET;
	if (!secret) throw new Error('SESSION_SECRET is required for e2e cookies');
	return new SignJWT({ enrollmentId, typ: 'enrollment' })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('30d')
		.sign(new TextEncoder().encode(secret));
}

export function uniqueEmail(prefix = 'e2e') {
	return `${prefix}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

export async function seedEnrollment(input: {
	email: string;
	firstName?: string;
	lastName?: string;
	collectionStatus?: 'pending' | 'current' | 'paid';
	contractStatus?: 'pending' | 'sent' | 'signed';
	accessStatus?: 'not_eligible' | 'pending' | 'active';
	stripeCheckoutSessionId?: string | null;
	yousignRequestId?: string | null;
}) {
	const db = getPrisma();
	const user = await db.user.create({
		data: {
			email: input.email.toLowerCase(),
			firstName: input.firstName ?? 'Camille',
			lastName: input.lastName ?? 'Martin',
		},
	});

	return db.enrollment.create({
		data: {
			userId: user.id,
			collectionStatus: input.collectionStatus ?? 'pending',
			contractStatus: input.contractStatus ?? 'pending',
			accessStatus: input.accessStatus ?? 'not_eligible',
			paymentPlan: 'unique',
			installmentsTotal: 1,
			totalAmountCents: 184_900,
			amountCents: 184_900,
			stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? undefined,
			yousignRequestId: input.yousignRequestId ?? undefined,
			consentCgvAt: new Date(),
			consentNdaAt: new Date(),
			consentPrivacyAt: new Date(),
			consentWithdrawalWaiverAt: new Date(),
		},
		include: { user: true },
	});
}

export async function seedMagicLink(enrollmentId: string, token: string, used = false) {
	return getPrisma().magicLink.create({
		data: {
			enrollmentId,
			tokenHash: hashToken(token),
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			usedAt: used ? new Date() : null,
		},
	});
}

export async function findEnrollmentByEmail(email: string) {
	return getPrisma().enrollment.findFirst({
		where: { user: { email: email.toLowerCase() } },
		orderBy: { createdAt: 'desc' },
		include: { user: true },
	});
}

export async function enrollmentCookie(
	enrollmentId: string,
	origin = `http://127.0.0.1:${process.env.E2E_PORT ?? 4322}`,
) {
	const token = await createEnrollmentSessionToken(enrollmentId);
	return {
		name: 'dv_enrollment',
		value: token,
		url: origin,
		httpOnly: true,
		sameSite: 'Lax' as const,
	};
}

export const checkoutBody = (email: string) => ({
	firstName: 'Camille',
	lastName: 'Martin',
	email,
	paymentPlan: 'unique',
	consentCgv: true,
	consentNda: true,
	consentPrivacy: true,
	consentWithdrawalWaiver: true,
});
