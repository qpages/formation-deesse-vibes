import type Stripe from 'stripe';
import type { ContractStatus, Enrollment } from '../../generated/prisma/client';
import { getPrisma } from '../prisma';
import {
	getPaymentPlan,
	resolvePaymentPlan,
	stripePriceIdForPlan,
	type PaymentPlanId,
} from '../payment-plans';
import { type EnqueueResult } from '../inngest/client';
import { applyAccessPolicy } from '../enrollment/access';
import {
	attachStripeCheckoutSession,
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	type EnrollmentWithUser,
} from '../enrollment';
import { notifyOps } from '../services/slack';
import {
	createCheckoutSession,
	ensureSubscriptionSchedule,
	expireCheckoutSession,
	findInvoiceForPaidCheckout,
	getStripe,
	retrieveCheckoutSession,
	retrieveSubscription,
} from '../stripe';
import { ensureNdaAfterPayment } from './nda-trigger';
import { notifyInstallmentPaid } from './notifications';
import { mapSubscriptionStatus } from './stripe-status';
import { recomputeEnrollmentCollectionState, syncStripeInvoice } from './invoice-sync';
import { stripeId } from './stripe-id';

export class CheckoutAlreadyPaidError extends Error {
	constructor() {
		super('Checkout déjà payé');
		this.name = 'CheckoutAlreadyPaidError';
	}
}

export type ConfirmCheckoutResult =
	| {
			ok: true;
			enrollmentId: string;
			alreadyConfirmed: boolean;
			contractStatus: ContractStatus;
			ndaEnqueue?: EnqueueResult;
	  }
	| { ok: false; reason: string };

function subscriptionIdFromSession(session: Stripe.Checkout.Session): string | undefined {
	return stripeId(session.subscription);
}

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | undefined {
	return stripeId(session.payment_intent);
}

function resolvePlanFromMetadata(metadata: Stripe.Metadata | null | undefined) {
	const raw = metadata?.paymentPlan;
	if (!raw) return null;
	return resolvePaymentPlan(raw);
}

/** Mark enrollment paid when still pending collection; returns false if already confirmed. */
async function updateEnrollmentPaymentConfirmed(
	enrollmentId: string,
	extra: Record<string, unknown> = {},
): Promise<boolean> {
	const result = await getPrisma().enrollment.updateMany({
		where: { id: enrollmentId, collectionStatus: 'pending' },
		data: {
			collectionStatus: 'current',
			...extra,
		},
	});
	return result.count > 0;
}

/** Promo codes autorisés → amount_total peut être < prix attendu pour le plan. */
export function assertCheckoutAmountAcceptable(
	session: Stripe.Checkout.Session,
	expectedMaxCents: number,
) {
	const total = session.amount_total;
	if (total == null) {
		throw new Error('Checkout sans amount_total');
	}
	if (total < 0 || total > expectedMaxCents) {
		throw new Error(`Montant Checkout incorrect: ${total} (max attendu ${expectedMaxCents})`);
	}
}

export function isCheckoutPaid(session: Stripe.Checkout.Session) {
	return session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
}

async function syncOneTimePaymentFromCheckout(
	enrollment: EnrollmentWithUser,
	session: Stripe.Checkout.Session,
) {
	const invoice = await findInvoiceForPaidCheckout(session);
	if (invoice) {
		await syncStripeInvoice(invoice, { enrollmentId: enrollment.id });
		return;
	}

	const prisma = getPrisma();
	const paymentIntentId = paymentIntentIdFromSession(session);
	const amount = session.amount_total ?? enrollment.amountCents;

	const previous = await prisma.payment.findUnique({
		where: {
			enrollmentId_installmentNumber: {
				enrollmentId: enrollment.id,
				installmentNumber: 1,
			},
		},
		select: { status: true },
	});
	const becamePaid = previous?.status !== 'paid';

	await prisma.payment.upsert({
		where: {
			enrollmentId_installmentNumber: {
				enrollmentId: enrollment.id,
				installmentNumber: 1,
			},
		},
		create: {
			enrollmentId: enrollment.id,
			stripePaymentIntentId: paymentIntentId,
			installmentNumber: 1,
			amountCents: amount,
			currency: session.currency ?? 'eur',
			status: 'paid',
			paidAt: new Date(),
		},
		update: {
			stripePaymentIntentId: paymentIntentId,
			amountCents: amount,
			currency: session.currency ?? 'eur',
			status: 'paid',
			paidAt: new Date(),
		},
	});

	await recomputeEnrollmentCollectionState(enrollment.id);

	if (becamePaid) {
		await notifyInstallmentPaid(enrollment, 1, amount);
	}
}

async function syncSubscriptionCheckout(
	enrollment: Enrollment,
	session: Stripe.Checkout.Session,
	planId: PaymentPlanId,
) {
	const subscriptionId = subscriptionIdFromSession(session);
	if (!subscriptionId) {
		throw new Error('Checkout subscription sans subscriptionId');
	}

	const plan = getPaymentPlan(planId);
	const priceId = stripePriceIdForPlan(plan);
	const scheduleId = await ensureSubscriptionSchedule({
		subscriptionId,
		priceId,
		installments: plan.installments,
		existingScheduleId: enrollment.stripeScheduleId,
	});

	const subscription = await retrieveSubscription(subscriptionId);

	await getPrisma().enrollment.update({
		where: { id: enrollment.id },
		data: {
			stripeSubscriptionId: subscriptionId,
			stripeScheduleId: scheduleId,
			subscriptionStatus: mapSubscriptionStatus(subscription.status),
		},
	});

	const latestInvoiceId =
		typeof subscription.latest_invoice === 'string'
			? subscription.latest_invoice
			: subscription.latest_invoice?.id;

	if (latestInvoiceId) {
		const invoice = await getStripe().invoices.retrieve(latestInvoiceId);
		await syncStripeInvoice(invoice, { enrollmentId: enrollment.id });
	}
}

/**
 * Démarre un Checkout : 1 enrollment pending = au plus 1 session open.
 * Expire l’ancienne session open avant d’en créer une nouvelle.
 */
export async function startCheckout(input: {
	enrollment: EnrollmentWithUser;
	paymentPlan: PaymentPlanId;
	successUrl: string;
	cancelUrl: string;
}): Promise<{ url: string }> {
	const { enrollment, paymentPlan, successUrl, cancelUrl } = input;
	const prev = enrollment.stripeCheckoutSessionId;

	if (prev) {
		try {
			const existing = await retrieveCheckoutSession(prev);
			if (existing.status === 'open') {
				await expireCheckoutSession(prev);
			} else if (existing.status === 'complete' && isCheckoutPaid(existing)) {
				await confirmPaidCheckout(existing);
				throw new CheckoutAlreadyPaidError();
			}
		} catch (error) {
			if (error instanceof CheckoutAlreadyPaidError) throw error;
			// Session Stripe introuvable / réseau : on continue et on crée une nouvelle.
			console.warn('[startCheckout] previous session unreachable', prev, error);
		}
	}

	const session = await createCheckoutSession({
		enrollmentId: enrollment.id,
		email: enrollment.user.email,
		firstName: enrollment.user.firstName,
		lastName: enrollment.user.lastName,
		paymentPlan,
		successUrl,
		cancelUrl,
	});

	await attachStripeCheckoutSession(enrollment.id, session.id);

	if (!prev) {
		const { user } = enrollment;
		await notifyOps({
			kind: 'checkout.created',
			severity: 'info',
			title: 'Checkout ouvert',
			enrollmentId: enrollment.id,
			email: user.email,
			detail: `${user.firstName} ${user.lastName} | plan=${paymentPlan}`,
		});
	}

	if (!session.url) {
		throw new Error('Checkout sans url');
	}

	return { url: session.url };
}

/**
 * Confirme un Checkout payé : collectionStatus → current (money only).
 * Idempotent. Ne confirme pas si payment_status n’est pas paid.
 * Orchestration NDA = stripe-events / admin retrigger (pas ici).
 */
export async function confirmPaidCheckout(
	session: Stripe.Checkout.Session,
	opts: { softEnqueue?: boolean } = {},
): Promise<ConfirmCheckoutResult> {
	const enrollmentId = session.metadata?.enrollmentId ?? session.client_reference_id ?? undefined;
	if (!enrollmentId) {
		throw new Error('Checkout sans enrollmentId');
	}

	const prisma = getPrisma();
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		throw new Error(`Enrollment introuvable: ${enrollmentId}`);
	}

	const plan =
		resolvePlanFromMetadata(session.metadata) ??
		(enrollment.paymentPlan ? getPaymentPlan(enrollment.paymentPlan) : null);

	const expectedMax = plan?.installmentAmountCents ?? enrollment.amountCents;
	assertCheckoutAmountAcceptable(session, expectedMax);

	if (!isCheckoutPaid(session)) {
		return {
			ok: false,
			reason: `payment_status=${session.payment_status}`,
		};
	}

	// Session stale payée après remplacement : on confirme quand même (argent reçu).
	if (
		enrollment.stripeCheckoutSessionId &&
		enrollment.stripeCheckoutSessionId !== session.id &&
		enrollment.collectionStatus === 'pending'
	) {
		console.warn('[checkout] stale_session_paid', {
			enrollmentId,
			stored: enrollment.stripeCheckoutSessionId,
			paid: session.id,
		});
	}

	const paymentIntentId = paymentIntentIdFromSession(session);
	const subscriptionId = subscriptionIdFromSession(session);
	const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

	if (customerId) {
		await prisma.user.update({
			where: { id: enrollment.userId },
			data: { stripeCustomerId: customerId },
		});
	}

	const transitioned = await updateEnrollmentPaymentConfirmed(enrollmentId, {
		stripeCheckoutSessionId: session.id,
		stripePaymentIntentId: paymentIntentId,
		stripeSubscriptionId: subscriptionId,
		amountCents: session.amount_total ?? enrollment.amountCents,
		...(plan
			? {
					paymentPlan: plan.id,
					installmentsTotal: plan.installments,
					totalAmountCents: plan.totalAmountCents,
				}
			: {}),
	});

	const fresh = await findEnrollmentByIdOrThrow(enrollmentId);

	if (session.mode === 'subscription' && plan?.mode === 'subscription') {
		await syncSubscriptionCheckout(fresh, session, plan.id);
	} else {
		await syncOneTimePaymentFromCheckout(fresh, session);
	}

	await applyAccessPolicy(enrollmentId);

	if (transitioned) {
		await notifyOps({
			kind: 'payment.first_confirmed',
			severity: 'info',
			title: 'Premier paiement confirmé',
			enrollmentId,
			email: fresh.user.email,
			detail: [
				`${fresh.user.firstName} ${fresh.user.lastName}`,
				fresh.paymentPlan ? `plan=${fresh.paymentPlan}` : null,
			]
				.filter(Boolean)
				.join(' | '),
		});
	}

	// Même post-condition quel que soit l’appelant (webhook / page / admin).
	const ndaEnqueue = await ensureNdaAfterPayment(enrollmentId, session.id, {
		soft: opts.softEnqueue,
	});

	return {
		ok: true,
		enrollmentId,
		alreadyConfirmed: !transitioned,
		contractStatus: fresh.contractStatus,
		ndaEnqueue,
	};
}
