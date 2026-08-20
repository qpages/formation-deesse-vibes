import type { AccessStatus } from '../../generated/prisma/client';
import { isOverdueForAccess } from '../enrollment-gates';
import { sendInngestSafe } from '../inngest/client';
import { getPrisma } from '../prisma';
import { findEnrollmentForAccessPolicy } from './queries';

export type AccessDecision =
	| { shouldHaveAccess: true; reason: 'ELIGIBLE' }
	| {
			shouldHaveAccess: false;
			reason:
				| 'ORDER_CANCELED'
				| 'ORDER_REFUNDED'
				| 'INITIAL_PAYMENT_MISSING'
				| 'CONTRACT_NOT_SIGNED'
				| 'OVERDUE_INSTALLMENT';
	  };

/**
 * Pure access policy (Strategy / Guard Clauses).
 * Priorités : canceled → refunded → 1er paiement → contrat → impayé → éligible.
 */
export function evaluateAccess(input: {
	firstPaymentPaid: boolean;
	contractSigned: boolean;
	hasOverdueInstallment: boolean;
	orderCanceled: boolean;
	orderRefunded: boolean;
}): AccessDecision {
	if (input.orderCanceled) {
		return { shouldHaveAccess: false, reason: 'ORDER_CANCELED' };
	}
	if (input.orderRefunded) {
		return { shouldHaveAccess: false, reason: 'ORDER_REFUNDED' };
	}
	if (!input.firstPaymentPaid) {
		return { shouldHaveAccess: false, reason: 'INITIAL_PAYMENT_MISSING' };
	}
	if (!input.contractSigned) {
		return { shouldHaveAccess: false, reason: 'CONTRACT_NOT_SIGNED' };
	}
	if (input.hasOverdueInstallment) {
		return { shouldHaveAccess: false, reason: 'OVERDUE_INSTALLMENT' };
	}
	return { shouldHaveAccess: true, reason: 'ELIGIBLE' };
}

function targetAccessStatus(decision: AccessDecision, current: AccessStatus): AccessStatus | null {
	if (!decision.shouldHaveAccess) {
		if (decision.reason === 'ORDER_CANCELED' || decision.reason === 'ORDER_REFUNDED') {
			return current === 'revoked' ? null : 'revoked';
		}
		if (decision.reason === 'OVERDUE_INSTALLMENT') {
			if (current === 'active') return 'suspended';
			if (current === 'pending') return 'not_eligible';
			return null;
		}
		// not eligible yet (payment / contract)
		if (current === 'active') return 'suspended';
		if (current === 'pending' || current === 'suspended') return 'not_eligible';
		return null;
	}

	// eligible
	if (current === 'not_eligible' || current === 'suspended') return 'pending';
	return null;
}

/**
 * Modifier: lit les états, décide, update accessStatus, emit side effects via Inngest.
 * Suspend impayé → block Teachizy + e-mail. Revoke → block définitif. Grant → unblock + invite.
 * Ne passe jamais directement à `active` sans confirmation Teachizy.
 */
export async function applyAccessPolicy(enrollmentId: string): Promise<{
	decision: AccessDecision;
	previous: AccessStatus;
	next: AccessStatus;
	emitted: 'grant' | 'suspend' | 'revoke' | null;
}> {
	const enrollment = await findEnrollmentForAccessPolicy(enrollmentId);

	const firstPaymentPaid =
		enrollment.installmentsPaid >= 1 || enrollment.firstPaymentPaidAt != null;
	const contractSigned = enrollment.contractStatus === 'signed';
	const orderCanceled = enrollment.collectionStatus === 'canceled';
	const orderRefunded = enrollment.collectionStatus === 'refunded';

	const decision = evaluateAccess({
		firstPaymentPaid,
		contractSigned,
		hasOverdueInstallment: isOverdueForAccess(enrollment.collectionStatus),
		orderCanceled,
		orderRefunded,
	});

	const previous = enrollment.accessStatus;
	const next = targetAccessStatus(decision, previous) ?? previous;

	if (next === previous) {
		return { decision, previous, next, emitted: null };
	}

	const now = new Date();
	const data: {
		accessStatus: AccessStatus;
		accessSuspendedAt?: Date | null;
		accessRevokedAt?: Date | null;
	} = { accessStatus: next };

	if (next === 'suspended') {
		data.accessSuspendedAt = now;
	}
	if (next === 'revoked') {
		data.accessRevokedAt = now;
	}
	if (next === 'pending' && previous === 'suspended') {
		data.accessSuspendedAt = null;
	}

	await getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data,
	});

	let emitted: 'grant' | 'suspend' | 'revoke' | null = null;
	if (next === 'pending' && (previous === 'not_eligible' || previous === 'suspended')) {
		await sendInngestSafe({
			name: 'enrollment/access.grant',
			data: { enrollmentId },
		});
		emitted = 'grant';
	} else if (
		next === 'suspended' &&
		previous === 'active' &&
		decision.reason === 'OVERDUE_INSTALLMENT'
	) {
		await sendInngestSafe({
			name: 'enrollment/access.suspend',
			data: { enrollmentId, reason: 'OVERDUE_INSTALLMENT' },
		});
		emitted = 'suspend';
	} else if (next === 'revoked' && previous !== 'revoked') {
		await sendInngestSafe({
			name: 'enrollment/access.revoke',
			data: { enrollmentId },
		});
		emitted = 'revoke';
	}

	return { decision, previous, next, emitted };
}
