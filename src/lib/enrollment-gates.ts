import type {
	AccessStatus,
	CollectionStatus,
	ContractStatus,
	PaymentStatus,
} from '../generated/prisma/client';

/** Premier paiement confirmé (hors pending / canceled). */
export function isPaidEnough(collectionStatus: CollectionStatus): boolean {
	return collectionStatus !== 'pending' && collectionStatus !== 'canceled';
}

/** NDA en attente de signature après paiement. */
export function isAwaitingNda(input: {
	collectionStatus: CollectionStatus;
	contractStatus: ContractStatus;
	accessStatus: AccessStatus;
}): boolean {
	return (
		isPaidEnough(input.collectionStatus) &&
		(input.contractStatus === 'sent' || input.contractStatus === 'pending') &&
		input.accessStatus === 'not_eligible'
	);
}

export function hasOpenOrFailedPayments(
	payments: { status: PaymentStatus }[],
): boolean {
	return payments.some((p) => p.status === 'open' || p.status === 'failed');
}

export function hasFailedPayments(payments: { status: PaymentStatus }[]): boolean {
	return payments.some((p) => p.status === 'failed');
}

/**
 * Source de vérité overdue pour la politique d’accès = collectionStatus
 * (posé par recomputeEnrollmentCollectionState).
 */
export function isOverdueForAccess(collectionStatus: CollectionStatus): boolean {
	return collectionStatus === 'past_due';
}
