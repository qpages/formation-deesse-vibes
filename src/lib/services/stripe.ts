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

export async function assertPriceMatches(session: Stripe.Checkout.Session) {
	const expected = getEnv().STRIPE_AMOUNT_CENTS;
	if (session.amount_total !== expected) {
		throw new Error(
			`Montant Checkout incorrect: ${session.amount_total} ≠ ${expected}`,
		);
	}
}
