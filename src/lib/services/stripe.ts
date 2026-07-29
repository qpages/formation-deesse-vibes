import Stripe from 'stripe';
import { FORMATION, getEnv, requireEnv } from '../env';

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
	if (!stripe) {
		stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
	}
	return stripe;
}

export async function createCheckoutSession(input: {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
	successUrl: string;
	cancelUrl: string;
}) {
	const env = getEnv();
	const client = getStripe();
	const amount = env.STRIPE_AMOUNT_CENTS;

	if (amount !== FORMATION.priceCents) {
		throw new Error(`Montant Stripe invalide: attendu ${FORMATION.priceCents}, reçu ${amount}`);
	}

	return client.checkout.sessions.create({
		mode: 'payment',
		customer_email: input.email,
		allow_promotion_codes: true,
		line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
		success_url: input.successUrl,
		cancel_url: input.cancelUrl,
		client_reference_id: input.enrollmentId,
		metadata: {
			enrollmentId: input.enrollmentId,
			firstName: input.firstName,
			lastName: input.lastName,
		},
		payment_intent_data: {
			metadata: {
				enrollmentId: input.enrollmentId,
			},
		},
	});
}

export function constructStripeEvent(body: string, signature: string) {
	return getStripe().webhooks.constructEvent(
		body,
		signature,
		requireEnv('STRIPE_WEBHOOK_SECRET'),
	);
}

/** Lien Dashboard Stripe pour un paiement / une session Checkout. */
export function stripeDashboardUrl(input: {
	paymentIntentId?: string | null;
	checkoutSessionId?: string | null;
}): string | null {
	const key = getEnv().STRIPE_SECRET_KEY ?? '';
	const base = key.startsWith('sk_test_')
		? 'https://dashboard.stripe.com/test'
		: 'https://dashboard.stripe.com';

	if (input.paymentIntentId) {
		return `${base}/payments/${input.paymentIntentId}`;
	}
	if (input.checkoutSessionId) {
		return `${base}/checkout/sessions/${input.checkoutSessionId}`;
	}
	return null;
}
