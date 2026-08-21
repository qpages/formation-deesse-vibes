import { getPrisma } from '../prisma';
import { findEnrollmentById } from '../enrollment';
import { retrieveCheckoutSession } from '../stripe';
import { confirmPaidCheckout, type ConfirmCheckoutResult } from './checkout';
import { hydrateInvoiceUrls } from './invoice-links';
import { recomputeEnrollmentCollectionState } from './invoice-sync';
import { ensureNdaAfterPayment } from './nda-trigger';
import { syncAllSubscriptionInvoices } from './subscription-sync';

/**
 * Répare une inscription bloquée via Stripe.
 * Confirme le paiement si besoin, puis enqueue le NDA s’il manque encore
 * (même post-condition que le webhook — pas de chemin « money only » divergent).
 */
export async function syncPaymentFromStripe(enrollmentId: string): Promise<ConfirmCheckoutResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}

	if (enrollment.collectionStatus !== 'pending') {
		if (enrollment.stripeSubscriptionId) {
			await syncAllSubscriptionInvoices(enrollmentId);
		} else {
			const payments = await getPrisma().payment.findMany({
				where: { enrollmentId },
				orderBy: { installmentNumber: 'asc' },
			});
			await hydrateInvoiceUrls(payments);
			await recomputeEnrollmentCollectionState(enrollmentId);
		}
		const ndaEnqueue = await ensureNdaAfterPayment(
			enrollmentId,
			enrollment.stripeCheckoutSessionId ?? `admin-sync:${enrollmentId}`,
			{ soft: true },
		);
		return {
			ok: true,
			enrollmentId,
			alreadyConfirmed: true,
			contractStatus: enrollment.contractStatus,
			ndaEnqueue,
		};
	}
	if (!enrollment.stripeCheckoutSessionId) {
		return { ok: false, reason: 'no_checkout_session' };
	}

	const session = await retrieveCheckoutSession(enrollment.stripeCheckoutSessionId);
	const result = await confirmPaidCheckout(session, { softEnqueue: true });

	if (result.ok && enrollment.stripeSubscriptionId) {
		await syncAllSubscriptionInvoices(enrollmentId);
	}

	return result;
}
