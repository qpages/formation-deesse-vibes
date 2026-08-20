import { getPrisma } from '../prisma';
import { applyAccessPolicy } from '../enrollment/access';
import { findEnrollmentById } from '../enrollment';
import { notifyOps } from '../services/slack';

/**
 * Refund total / dispute Stripe → collectionStatus refunded + révocation accès.
 * Idempotent : ne renotifie pas si déjà refunded. `recompute` conserve ensuite
 * ce statut (les syncs invoice suivants ne le réécrasent pas).
 */
export async function markEnrollmentRefunded(
	enrollmentId: string,
	reason: 'refund' | 'dispute',
): Promise<{ ok: true; enrollmentId: string } | { ok: false; reason: string }> {
	const prisma = getPrisma();
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}

	if (enrollment.collectionStatus !== 'refunded') {
		const previous = enrollment.collectionStatus;
		await prisma.enrollment.update({
			where: { id: enrollmentId },
			data: { collectionStatus: 'refunded' },
		});
		await notifyOps({
			kind: 'collection.refunded',
			severity: reason === 'dispute' ? 'critical' : 'warn',
			title: reason === 'dispute' ? 'Litige Stripe (chargeback)' : 'Collection remboursée',
			enrollmentId,
			email: enrollment.user.email,
			detail: `${previous} → refunded (${reason})`,
		});
	}

	await applyAccessPolicy(enrollmentId);

	return { ok: true, enrollmentId };
}
