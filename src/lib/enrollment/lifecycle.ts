import type { ContractStatus, PaymentPlanId } from '../../generated/prisma/client';
import { getPaymentPlan } from '../payment-plans';
import { getPrisma } from '../prisma';
import { withUser } from './queries';

/** "camille" / "MArtin" / "jean-pierre" → "Camille" / "Martin" / "Jean-Pierre" */
function normalizePersonName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}

export async function attachStripeCheckoutSession(enrollmentId: string, sessionId: string) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: { stripeCheckoutSessionId: sessionId },
		...withUser,
	});
}

export async function updateEnrollmentContractMirror(
	enrollmentId: string,
	data: {
		contractStatus?: ContractStatus;
		signatureLinkExpiresAt?: Date | null;
		ndaNotifiedAt?: Date | null;
		ndaLinkOpenedAt?: Date | null;
		ndaSignedAt?: Date | null;
		ndaDeliveryFailedAt?: Date | null;
	},
) {
	return getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			...(data.contractStatus ? { contractStatus: data.contractStatus } : {}),
			...(data.signatureLinkExpiresAt !== undefined
				? { signatureLinkExpiresAt: data.signatureLinkExpiresAt }
				: {}),
			...(data.ndaNotifiedAt !== undefined ? { ndaNotifiedAt: data.ndaNotifiedAt } : {}),
			...(data.ndaLinkOpenedAt !== undefined ? { ndaLinkOpenedAt: data.ndaLinkOpenedAt } : {}),
			...(data.ndaSignedAt !== undefined ? { ndaSignedAt: data.ndaSignedAt } : {}),
			...(data.ndaDeliveryFailedAt !== undefined
				? { ndaDeliveryFailedAt: data.ndaDeliveryFailedAt }
				: {}),
		},
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
