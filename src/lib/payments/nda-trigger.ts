import { isPaidEnough } from '../enrollment-gates';
import { sendInngestSafe, type EnqueueResult } from '../inngest/client';
import { findEnrollmentById } from '../enrollment';
import { isNdaFullyProvisioned } from '../signature/helpers';

/**
 * Post-condition unique : paiement OK + NDA manquant → enqueue création NDA (provider configuré).
 * Idempotent (le job Inngest skip si déjà provisionné). Tous les chemins
 * (webhook, retour Checkout, sync admin) doivent passer par ici.
 */
export async function ensureNdaAfterPayment(
	enrollmentId: string,
	sourceId: string,
	opts: { soft?: boolean } = {},
): Promise<EnqueueResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) return { status: 'skipped' };
	if (!isPaidEnough(enrollment.collectionStatus)) return { status: 'skipped' };
	if (enrollment.contractStatus !== 'pending' && enrollment.contractStatus !== 'sent') {
		return { status: 'skipped' };
	}
	if (isNdaFullyProvisioned(enrollment)) return { status: 'skipped' };

	const result = await sendInngestSafe({
		id: `nda-after-payment:${enrollmentId}:${sourceId}`,
		name: 'stripe/payment.confirmed',
		data: { enrollmentId, stripeEventId: sourceId },
	});

	// Chemin « dur » (webhook / retour Checkout) : rejeter pour laisser Inngest rejouer.
	if (result.status === 'failed' && !opts.soft) {
		throw new Error(`Enqueue NDA échoué: ${result.error}`);
	}
	return result;
}
