import Stripe from 'stripe';
import { getEnv, requireEnv } from './env';
import { getPaymentPlan, type PaymentPlanId, stripePriceIdForPlan } from './payment-plans';

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
	paymentPlan: PaymentPlanId;
	successUrl: string;
	cancelUrl: string;
}) {
	const plan = getPaymentPlan(input.paymentPlan);
	const client = getStripe();
	const priceId = stripePriceIdForPlan(plan);

	const metadata = {
		enrollmentId: input.enrollmentId,
		firstName: input.firstName,
		lastName: input.lastName,
		paymentPlan: plan.id,
		installmentsTotal: String(plan.installments),
	};

	if (plan.mode === 'payment') {
		return client.checkout.sessions.create({
			mode: 'payment',
			customer_email: input.email,
			allow_promotion_codes: true,
			line_items: [{ price: priceId, quantity: 1 }],
			success_url: input.successUrl,
			cancel_url: input.cancelUrl,
			client_reference_id: input.enrollmentId,
			metadata,
			invoice_creation: {
				enabled: true,
				invoice_data: {
					description: 'Formation Matrice Évolution — paiement unique',
					metadata: {
						enrollmentId: input.enrollmentId,
						paymentPlan: plan.id,
					},
				},
			},
			payment_intent_data: {
				metadata: { enrollmentId: input.enrollmentId, paymentPlan: plan.id },
			},
		});
	}

	return client.checkout.sessions.create({
		mode: 'subscription',
		customer_email: input.email,
		allow_promotion_codes: true,
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: input.successUrl,
		cancel_url: input.cancelUrl,
		client_reference_id: input.enrollmentId,
		metadata,
		custom_text: {
			submit: {
				message: `Paiement en ${plan.installments} fois — arrêt automatique après ${plan.installments} mois.`,
			},
		},
		subscription_data: {
			metadata,
		},
	});
}

/**
 * Configure un Subscription Schedule pour terminer l'abonnement après N échéances.
 * Idempotent : ne recrée pas si un schedule existe déjà sur la souscription.
 */
export async function ensureSubscriptionSchedule(input: {
	subscriptionId: string;
	priceId: string;
	installments: number;
	existingScheduleId?: string | null;
}): Promise<string> {
	const client = getStripe();

	if (input.existingScheduleId) {
		return input.existingScheduleId;
	}

	const subscription = await client.subscriptions.retrieve(input.subscriptionId);
	if (subscription.schedule) {
		return typeof subscription.schedule === 'string'
			? subscription.schedule
			: subscription.schedule.id;
	}

	const schedule = await client.subscriptionSchedules.create({
		from_subscription: input.subscriptionId,
	});

	const currentPhase = schedule.phases[0];
	if (!currentPhase) {
		throw new Error(`Subscription schedule ${schedule.id} sans phase initiale`);
	}

	await client.subscriptionSchedules.update(schedule.id, {
		end_behavior: 'cancel',
		phases: [
			{
				items: [{ price: input.priceId, quantity: 1 }],
				iterations: input.installments,
				start_date: currentPhase.start_date,
			} as Stripe.SubscriptionScheduleUpdateParams.Phase,
		],
	});

	return schedule.id;
}

export function constructStripeEvent(body: string, signature: string) {
	return getStripe().webhooks.constructEvent(
		body,
		signature,
		requireEnv('STRIPE_WEBHOOK_SECRET'),
	);
}

function dashboardBase(): string {
	const key = getEnv().STRIPE_SECRET_KEY ?? '';
	return key.startsWith('sk_test_')
		? 'https://dashboard.stripe.com/test'
		: 'https://dashboard.stripe.com';
}

/** Liens Dashboard Stripe pour paiement / session / abonnement / facture. */
export function stripeDashboardUrl(input: {
	paymentIntentId?: string | null;
	checkoutSessionId?: string | null;
	subscriptionId?: string | null;
	invoiceId?: string | null;
	scheduleId?: string | null;
}): string | null {
	const base = dashboardBase();

	if (input.paymentIntentId) {
		return `${base}/payments/${input.paymentIntentId}`;
	}
	if (input.invoiceId) {
		return `${base}/invoices/${input.invoiceId}`;
	}
	if (input.subscriptionId) {
		return `${base}/subscriptions/${input.subscriptionId}`;
	}
	if (input.scheduleId) {
		return `${base}/subscription_schedules/${input.scheduleId}`;
	}
	if (input.checkoutSessionId) {
		return `${base}/checkout/sessions/${input.checkoutSessionId}`;
	}
	return null;
}

export async function retrieveCheckoutSession(sessionId: string) {
	return getStripe().checkout.sessions.retrieve(sessionId);
}

/** Expire une session open. No-op si déjà complete / expired. */
export async function expireCheckoutSession(sessionId: string) {
	try {
		return await getStripe().checkout.sessions.expire(sessionId);
	} catch (error) {
		if (
			typeof error === 'object' &&
			error &&
			'type' in error &&
			(error as { type: string }).type === 'StripeInvalidRequestError'
		) {
			return null;
		}
		throw error;
	}
}

export async function retrieveSubscription(subscriptionId: string) {
	return getStripe().subscriptions.retrieve(subscriptionId);
}

export async function listSubscriptionInvoices(subscriptionId: string) {
	return getStripe().invoices.list({ subscription: subscriptionId, limit: 100 });
}

export async function retrieveInvoice(invoiceId: string) {
	return getStripe().invoices.retrieve(invoiceId);
}
