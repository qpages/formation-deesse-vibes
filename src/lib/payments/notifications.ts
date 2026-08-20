import type { CollectionStatus } from '../../generated/prisma/client';
import { notifyOps, type OpsKind, type OpsSeverity } from '../services/slack';
import type { EnrollmentWithUser } from '../enrollment';

export const COLLECTION_NOTIFY: Partial<
	Record<CollectionStatus, { kind: OpsKind; severity: OpsSeverity; title: string }>
> = {
	past_due: {
		kind: 'collection.past_due',
		severity: 'warn',
		title: 'Collection en retard',
	},
	paid: {
		kind: 'collection.paid',
		severity: 'info',
		title: 'Collection soldée',
	},
	refunded: {
		kind: 'collection.refunded',
		severity: 'warn',
		title: 'Collection remboursée',
	},
};

export async function notifyInstallmentPaid(
	enrollment: EnrollmentWithUser,
	installmentNumber: number,
	amountCents: number,
) {
	const total = enrollment.installmentsTotal ?? 1;
	await notifyOps({
		kind: 'payment.installment_paid',
		severity: 'info',
		title: `Échéance ${installmentNumber}/${total} payée`,
		enrollmentId: enrollment.id,
		email: enrollment.user.email,
		detail: [
			`${enrollment.user.firstName} ${enrollment.user.lastName}`,
			enrollment.paymentPlan ? `plan=${enrollment.paymentPlan}` : null,
			`amount=${amountCents}`,
		]
			.filter(Boolean)
			.join(' | '),
	});
}

export async function notifyCollectionStatusChange(
	previous: CollectionStatus,
	collectionStatus: CollectionStatus,
	enrollmentId: string,
	email: string,
) {
	if (previous === collectionStatus) return;
	const notify = COLLECTION_NOTIFY[collectionStatus];
	if (notify) {
		await notifyOps({
			...notify,
			enrollmentId,
			email,
			detail: `${previous} → ${collectionStatus}`,
		});
	}
}
