import type Stripe from 'stripe';
import { inngest } from '../inngest/client';
import { getPrisma } from '../db';
import { getEnv } from '../env';
import { recordProcessedEvent, transitionStatus } from './enrollment';
import { getStripe } from './stripe';
import { isNdaFullyProvisioned } from './yousign';

export type ConfirmCheckoutResult =
	| { ok: true; enrollmentId: string; alreadyConfirmed: boolean }
	| { ok: false; reason: string };

/** Promo codes autorisés → amount_total peut être < prix catalogue. */
export function assertCheckoutAmountAcceptable(session: Stripe.Checkout.Session) {
	const expected = getEnv().STRIPE_AMOUNT_CENTS;
	const total = session.amount_total;
	if (total == null) {
		throw new Error('Checkout sans amount_total');
	}
	if (total < 0 || total > expected) {
		throw new Error(`Montant Checkout incorrect: ${total} (max attendu ${expected})`);
	}
}

export function isCheckoutPaid(session: Stripe.Checkout.Session) {
	return (
		session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
	);
}

export async function retrieveCheckoutSession(sessionId: string) {
	return getStripe().checkout.sessions.retrieve(sessionId);
}

/**
 * Confirme un Checkout payé : statut → paiement_confirme + event Inngest NDA.
 * Idempotent. Ne confirme pas si payment_status n’est pas paid.
 */
export async function confirmPaidCheckout(
	session: Stripe.Checkout.Session,
	options: { stripeEventId?: string } = {},
): Promise<ConfirmCheckoutResult> {
	assertCheckoutAmountAcceptable(session);

	if (!isCheckoutPaid(session)) {
		return {
			ok: false,
			reason: `payment_status=${session.payment_status}`,
		};
	}

	const enrollmentId =
		session.metadata?.enrollmentId ?? session.client_reference_id ?? undefined;
	if (!enrollmentId) {
		throw new Error('Checkout sans enrollmentId');
	}

	const prisma = getPrisma();
	const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
	if (!enrollment) {
		throw new Error(`Enrollment introuvable: ${enrollmentId}`);
	}

	if (options.stripeEventId) {
		await recordProcessedEvent({
			provider: 'stripe',
			eventId: `${options.stripeEventId}:link`,
			enrollmentId,
			payload: { sessionId: session.id },
		});
	}

	const paymentIntentId =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: session.payment_intent?.id;

	const transitioned = await transitionStatus(
		enrollmentId,
		'paiement_en_attente',
		'paiement_confirme',
		{
			stripeCheckoutSessionId: session.id,
			stripePaymentIntentId: paymentIntentId,
			stripeCustomerId:
				typeof session.customer === 'string' ? session.customer : session.customer?.id,
			amountCents: session.amount_total ?? enrollment.amountCents,
		},
	);

	const fresh = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });

	// Renvoi safe : Inngest skip si NDA déjà activé ; reprend un brouillon orphelin
	if (
		!isNdaFullyProvisioned(fresh) &&
		(fresh.status === 'paiement_confirme' || fresh.status === 'nda_envoye')
	) {
		await inngest.send({
			name: 'stripe/payment.confirmed',
			data: {
				enrollmentId,
				stripeEventId: options.stripeEventId ?? `reconcile:${session.id}`,
			},
		});
	}

	return { ok: true, enrollmentId, alreadyConfirmed: !transitioned };
}

/**
 * Déclenche manuellement la création NDA via Inngest
 *
 * Envoie l'événement `stripe/payment.confirmed` pour déclencher la fonction
 * Inngest `createNdaAfterPayment`.
 *
 * **Utilisé par:**
 * - Action admin "Forcer envoi NDA"
 * - Action admin "Synchroniser paiement" (si NDA manquant)
 *
 * **Guards:**
 * - Enrollment doit exister
 * - Status doit être `paiement_confirme` ou `nda_envoye`
 * - NDA pas encore pleinement provisionné (sinon déjà créé)
 *
 * @see docs/overview.md#inngest
 */
export async function triggerNdaAfterPayment(enrollmentId: string): Promise<
	| { ok: true }
	| { ok: false; reason: 'enrollment_not_found' | 'status_incompatible' | 'nda_already_created' }
> {
	const enrollment = await getPrisma().enrollment.findUnique({ where: { id: enrollmentId } });
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	if (
		enrollment.status !== 'paiement_confirme' &&
		enrollment.status !== 'nda_envoye'
	) {
		return { ok: false, reason: 'status_incompatible' };
	}
	if (isNdaFullyProvisioned(enrollment)) {
		return { ok: false, reason: 'nda_already_created' };
	}

	await inngest.send({
		name: 'stripe/payment.confirmed',
		data: {
			enrollmentId,
			stripeEventId: `admin-retrigger-nda:${enrollmentId}:${Date.now()}`,
		},
	});
	return { ok: true };
}

/**
 * Répare une inscription bloquée en vérifiant la session Stripe
 *
 * Cas d'usage :
 * - Paiement confirmé mais NDA jamais envoyé (Inngest offline)
 * - Status coincé en `paiement_en_attente` alors que Stripe dit "paid"
 *
 * **Action admin:** "Synchroniser paiement"
 */
export async function syncPaymentFromStripe(enrollmentId: string): Promise<ConfirmCheckoutResult> {
	const enrollment = await getPrisma().enrollment.findUnique({ where: { id: enrollmentId } });
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}

	// Payé mais NDA manquant / brouillon non activé → re-fire l’event
	if (
		!isNdaFullyProvisioned(enrollment) &&
		(enrollment.status === 'paiement_confirme' || enrollment.status === 'nda_envoye')
	) {
		await triggerNdaAfterPayment(enrollmentId);
		return { ok: true, enrollmentId, alreadyConfirmed: true };
	}

	if (enrollment.status !== 'paiement_en_attente') {
		return { ok: true, enrollmentId, alreadyConfirmed: true };
	}
	if (!enrollment.stripeCheckoutSessionId) {
		return { ok: false, reason: 'no_checkout_session' };
	}

	const session = await retrieveCheckoutSession(enrollment.stripeCheckoutSessionId);
	return confirmPaidCheckout(session, { stripeEventId: `admin-sync:${session.id}` });
}
