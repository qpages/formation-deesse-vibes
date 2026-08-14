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

/** Nombre de mois entiers couverts par une phase (borne = end_behavior cancel). */
function phaseMonths(phase: Stripe.SubscriptionSchedule.Phase): number {
	const start = new Date(phase.start_date * 1000);
	const end = new Date(phase.end_date * 1000);
	return (
		(end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
		(end.getUTCMonth() - start.getUTCMonth())
	);
}

/**
 * Un schedule est correctement borné ssi il s'arrête (`cancel`) après ≥ N mois.
 * Le défaut de `from_subscription` est `release` sur une seule échéance → à reconfigurer.
 */
function isScheduleBounded(
	schedule: Stripe.SubscriptionSchedule,
	installments: number,
): boolean {
	if (schedule.end_behavior !== 'cancel') return false;
	const lastPhase = schedule.phases.at(-1);
	if (!lastPhase) return false;
	return phaseMonths(lastPhase) >= installments;
}

async function resolveScheduleId(
	client: Stripe,
	input: { subscriptionId: string; existingScheduleId?: string | null },
): Promise<string> {
	if (input.existingScheduleId) {
		return input.existingScheduleId;
	}

	const subscription = await client.subscriptions.retrieve(input.subscriptionId);
	if (subscription.schedule) {
		return typeof subscription.schedule === 'string'
			? subscription.schedule
			: subscription.schedule.id;
	}

	const created = await client.subscriptionSchedules.create({
		from_subscription: input.subscriptionId,
	});
	return created.id;
}

/**
 * Configure un Subscription Schedule pour terminer l'abonnement après N échéances.
 * Idempotent MAIS pas aveugle : on relit toujours le schedule et on ne saute la
 * configuration que s'il est déjà borné (`cancel` + durée ≥ N mois). Un create OK
 * suivi d'un update KO est donc réparé au passage suivant au lieu d'être ignoré.
 */
export async function ensureSubscriptionSchedule(input: {
	subscriptionId: string;
	priceId: string;
	installments: number;
	existingScheduleId?: string | null;
}): Promise<string> {
	const client = getStripe();

	const scheduleId = await resolveScheduleId(client, input);
	const schedule = await client.subscriptionSchedules.retrieve(scheduleId);

	if (isScheduleBounded(schedule, input.installments)) {
		return schedule.id;
	}

	const currentPhase = schedule.phases[0];
	if (!currentPhase) {
		throw new Error(`Subscription schedule ${schedule.id} sans phase initiale`);
	}

	const updated = await client.subscriptionSchedules.update(schedule.id, {
		end_behavior: 'cancel',
		phases: [
			{
				items: [{ price: input.priceId, quantity: 1 }],
				duration: { interval: 'month', interval_count: input.installments },
				start_date: currentPhase.start_date,
			},
		],
	});

	if (!isScheduleBounded(updated, input.installments)) {
		throw new Error(
			`Subscription schedule ${updated.id} non borné après update ` +
				`(end_behavior=${updated.end_behavior}, installments=${input.installments})`,
		);
	}

	return updated.id;
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
