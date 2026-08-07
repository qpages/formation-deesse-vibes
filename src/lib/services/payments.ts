import type Stripe from 'stripe';
import type {
	CollectionStatus,
	ContractStatus,
	Enrollment,
	PaymentStatus,
	SubscriptionStatus,
} from '../../generated/prisma/client';
import { getPrisma } from '../prisma';
import {
	getPaymentPlan,
	resolvePaymentPlan,
	stripePriceIdForPlan,
	type PaymentPlanId,
} from '../payment-plans';
import { hasOpenOrFailedPayments } from '../enrollment-gates';
import { applyAccessPolicy } from './access';
import {
	attachStripeCheckoutSession,
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	findEnrollmentByScheduleOrSubscription,
	findEnrollmentBySubscriptionId,
	type EnrollmentWithUser,
} from './enrollment';
import {
	createCheckoutSession,
	ensureSubscriptionSchedule,
	expireCheckoutSession,
	getStripe,
	listSubscriptionInvoices,
	retrieveCheckoutSession,
	retrieveSubscription,
} from '../stripe';

export { retrieveCheckoutSession } from '../stripe';

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
	  }
	| { ok: false; reason: string };

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
	return (
		session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
	);
}

/** Expand Stripe string | { id } unions. */
function stripeId(ref: string | { id: string } | null | undefined): string | undefined {
	if (!ref) return undefined;
	return typeof ref === 'string' ? ref : ref.id;
}

function subscriptionIdFromSession(session: Stripe.Checkout.Session): string | undefined {
	return stripeId(session.subscription);
}

/** Stripe SDK typings omit some Invoice fields depending on API version. */
type InvoiceExtras = Stripe.Invoice & {
	payment_intent?: string | { id: string } | null;
	subscription?: string | { id: string } | null;
	subscription_details?: { metadata?: Stripe.Metadata | null } | null;
};

function paymentIntentIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
	return stripeId((invoice as InvoiceExtras).payment_intent);
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
	return stripeId((invoice as InvoiceExtras).subscription);
}

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | undefined {
	return stripeId(session.payment_intent);
}

function mapInvoiceStatus(status: Stripe.Invoice.Status | null): PaymentStatus {
	switch (status) {
		case 'paid':
			return 'paid';
		case 'open':
			return 'open';
		case 'uncollectible':
			return 'uncollectible';
		case 'void':
			return 'void';
		case 'draft':
			return 'draft';
		default:
			return 'open';
	}
}

/** Identity map — SubscriptionStatus = Stripe Subscription.status 1:1. */
function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
	switch (status) {
		case 'incomplete':
		case 'incomplete_expired':
		case 'trialing':
		case 'active':
		case 'past_due':
		case 'canceled':
		case 'unpaid':
		case 'paused':
			return status;
		default: {
			const _exhaustive: never = status;
			throw new Error(`Unknown Stripe subscription status: ${String(_exhaustive)}`);
		}
	}
}

function resolvePlanFromMetadata(metadata: Stripe.Metadata | null | undefined) {
	const raw = metadata?.paymentPlan;
	if (!raw) return null;
	return resolvePaymentPlan(raw);
}

async function resolveInstallmentNumber(
	enrollmentId: string,
	invoice: Stripe.Invoice,
): Promise<number> {
	const prisma = getPrisma();
	const existing = invoice.id
		? await prisma.payment.findUnique({ where: { stripeInvoiceId: invoice.id } })
		: null;
	if (existing) return existing.installmentNumber;

	const subscriptionId = subscriptionIdFromInvoice(invoice);

	if (subscriptionId) {
		const invoices = await listSubscriptionInvoices(subscriptionId);
		const sorted = invoices.data
			.filter((row) => row.id)
			.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
		const index = sorted.findIndex((row) => row.id === invoice.id);
		if (index >= 0) return index + 1;
	}

	const count = await prisma.payment.count({ where: { enrollmentId } });
	return count + 1;
}

/**
 * Recalcule agrégats Payment + collectionStatus (source de vérité = lignes Payment).
 * Règles : refunded/canceled explicites → past_due si failed/open → paid → current → pending.
 */
export async function recomputeEnrollmentCollectionState(enrollmentId: string) {
	const prisma = getPrisma();
	const enrollment = await findEnrollmentByIdOrThrow(enrollmentId);
	const payments = await prisma.payment.findMany({
		where: { enrollmentId },
		orderBy: { installmentNumber: 'asc' },
	});

	const paid = payments.filter((p) => p.status === 'paid');
	const failedOrOpen = payments.filter((p) => p.status === 'open' || p.status === 'failed');
	const collectedAmountCents = paid.reduce((sum, p) => sum + p.amountCents, 0);
	const installmentsPaid = paid.length;
	const installmentsTotal = enrollment.installmentsTotal ?? 1;

	const nextDue = failedOrOpen
		.map((p) => p.dueAt)
		.filter(Boolean)
		.sort((a, b) => a!.getTime() - b!.getTime())[0];

	const firstPaidAt =
		paid
			.map((p) => p.paidAt)
			.filter(Boolean)
			.sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;

	let collectionStatus: CollectionStatus;
	if (
		enrollment.collectionStatus === 'refunded' ||
		enrollment.collectionStatus === 'canceled'
	) {
		collectionStatus = enrollment.collectionStatus;
	} else if (hasOpenOrFailedPayments(payments) && installmentsPaid >= 1) {
		collectionStatus = 'past_due';
	} else if (failedOrOpen.some((p) => p.status === 'failed')) {
		collectionStatus = 'past_due';
	} else if (installmentsPaid >= installmentsTotal && installmentsPaid > 0) {
		collectionStatus = 'paid';
	} else if (installmentsPaid >= 1) {
		collectionStatus = 'current';
	} else {
		collectionStatus = 'pending';
	}

	const fullyPaidAt =
		collectionStatus === 'paid'
			? (enrollment.fullyPaidAt ??
				paid
					.map((p) => p.paidAt)
					.filter(Boolean)
					.sort((a, b) => b!.getTime() - a!.getTime())[0] ??
				new Date())
			: null;

	await prisma.enrollment.update({
		where: { id: enrollmentId },
		data: {
			installmentsPaid,
			collectedAmountCents,
			nextInstallmentDueAt: nextDue ?? null,
			collectionStatus,
			firstPaymentPaidAt: firstPaidAt ?? enrollment.firstPaymentPaidAt,
			fullyPaidAt,
		},
	});

	await applyAccessPolicy(enrollmentId);
}

function paymentFieldsFromInvoice(
	invoice: Stripe.Invoice,
	status: PaymentStatus,
	failureReason: string | null,
	paymentIntentId: string | undefined,
) {
	return {
		stripeInvoiceId: invoice.id,
		stripePaymentIntentId: paymentIntentId,
		amountCents: invoice.amount_paid || invoice.amount_due || 0,
		currency: invoice.currency ?? 'eur',
		status,
		failureReason,
		invoicePdfUrl: invoice.invoice_pdf ?? null,
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
		invoicedAt: invoice.created ? new Date(invoice.created * 1000) : null,
		paidAt: invoice.status_transitions?.paid_at
			? new Date(invoice.status_transitions.paid_at * 1000)
			: null,
		dueAt: invoice.due_date
			? new Date(invoice.due_date * 1000)
			: invoice.next_payment_attempt
				? new Date(invoice.next_payment_attempt * 1000)
				: null,
	};
}

export async function syncStripeInvoice(
	invoice: Stripe.Invoice,
	options: {
		enrollmentId?: string;
		forceStatus?: PaymentStatus;
	} = {},
) {
	const subscriptionId = subscriptionIdFromInvoice(invoice);

	const prisma = getPrisma();
	let enrollment: Enrollment | null = null;

	if (options.enrollmentId) {
		enrollment = await findEnrollmentById(options.enrollmentId);
	} else if (subscriptionId) {
		enrollment = await findEnrollmentBySubscriptionId(subscriptionId);
	}

	if (!enrollment) {
		const metaId =
			invoice.metadata?.enrollmentId ??
			(invoice as InvoiceExtras).subscription_details?.metadata?.enrollmentId;
		if (metaId) {
			enrollment = await findEnrollmentById(metaId);
		}
	}

	if (!enrollment) {
		return { ok: false as const, reason: 'enrollment_not_found' };
	}

	const installmentNumber = await resolveInstallmentNumber(enrollment.id, invoice);
	const status = options.forceStatus ?? mapInvoiceStatus(invoice.status);
	const failureReason =
		invoice.last_finalization_error?.message ??
		(invoice.status === 'open' && invoice.attempt_count > 0
			? `Tentative ${invoice.attempt_count}`
			: null);

	const paymentIntentId = paymentIntentIdFromInvoice(invoice);
	const fields = paymentFieldsFromInvoice(invoice, status, failureReason, paymentIntentId);

	await prisma.payment.upsert({
		where: {
			enrollmentId_installmentNumber: {
				enrollmentId: enrollment.id,
				installmentNumber,
			},
		},
		create: {
			enrollmentId: enrollment.id,
			installmentNumber,
			...fields,
		},
		update: fields,
	});

	await recomputeEnrollmentCollectionState(enrollment.id);

	return { ok: true as const, enrollmentId: enrollment.id };
}

async function syncOneTimePaymentFromCheckout(
	enrollment: Enrollment,
	session: Stripe.Checkout.Session,
) {
	const invoiceId =
		typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;

	if (invoiceId) {
		const invoice = await getStripe().invoices.retrieve(invoiceId);
		await syncStripeInvoice(invoice, { enrollmentId: enrollment.id });
		return;
	}

	const prisma = getPrisma();
	const paymentIntentId = paymentIntentIdFromSession(session);
	const amount = session.amount_total ?? enrollment.amountCents;

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
): Promise<ConfirmCheckoutResult> {
	const enrollmentId =
		session.metadata?.enrollmentId ?? session.client_reference_id ?? undefined;
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
	const customerId =
		typeof session.customer === 'string' ? session.customer : session.customer?.id;

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

	return {
		ok: true,
		enrollmentId,
		alreadyConfirmed: !transitioned,
		contractStatus: fresh.contractStatus,
	};
}

export async function syncSubscriptionState(subscription: Stripe.Subscription) {
	const subscriptionId = subscription.id;
	const prisma = getPrisma();
	const enrollment = await findEnrollmentBySubscriptionId(subscriptionId);

	if (!enrollment) {
		const metaId = subscription.metadata?.enrollmentId;
		if (!metaId) return { ok: false as const, reason: 'enrollment_not_found' };
		const byMeta = await findEnrollmentById(metaId);
		if (!byMeta) return { ok: false as const, reason: 'enrollment_not_found' };
		await prisma.enrollment.update({
			where: { id: byMeta.id },
			data: {
				stripeSubscriptionId: subscriptionId,
				subscriptionStatus: mapSubscriptionStatus(subscription.status),
			},
		});
		return { ok: true as const, enrollmentId: byMeta.id };
	}

	const scheduleId =
		typeof subscription.schedule === 'string'
			? subscription.schedule
			: subscription.schedule?.id;

	await prisma.enrollment.update({
		where: { id: enrollment.id },
		data: {
			subscriptionStatus: mapSubscriptionStatus(subscription.status),
			...(scheduleId ? { stripeScheduleId: scheduleId } : {}),
		},
	});

	return { ok: true as const, enrollmentId: enrollment.id };
}

/**
 * Schedule Stripe terminé → sync statut abo (souvent canceled) + clear prochaine échéance.
 * “Soldé” métier = collectionStatus / Payments, pas subscriptionStatus.
 */
export async function markSubscriptionScheduleCompleted(
	schedule: Stripe.SubscriptionSchedule,
) {
	const subscriptionId = stripeId(schedule.subscription);

	if (!subscriptionId) {
		return { ok: false as const, reason: 'no_subscription' };
	}

	const prisma = getPrisma();
	const enrollment = await findEnrollmentByScheduleOrSubscription(schedule.id, subscriptionId);

	if (!enrollment) {
		return { ok: false as const, reason: 'enrollment_not_found' };
	}

	const subscription = await retrieveSubscription(subscriptionId);

	await prisma.enrollment.update({
		where: { id: enrollment.id },
		data: {
			subscriptionStatus: mapSubscriptionStatus(subscription.status),
			nextInstallmentDueAt: null,
		},
	});

	return { ok: true as const, enrollmentId: enrollment.id };
}

export async function syncAllSubscriptionInvoices(enrollmentId: string) {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment?.stripeSubscriptionId) {
		return { ok: false as const, reason: 'no_subscription' };
	}

	const invoices = await listSubscriptionInvoices(enrollment.stripeSubscriptionId);
	for (const invoice of invoices.data) {
		await syncStripeInvoice(invoice, { enrollmentId });
	}

	const subscription = await retrieveSubscription(enrollment.stripeSubscriptionId);
	await syncSubscriptionState(subscription);

	return { ok: true as const, enrollmentId };
}

/**
 * Répare une inscription bloquée en vérifiant la session Stripe (money only).
 * NDA / Teachizy = jobs Inngest séparés (admin retrigger_nda, etc.).
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
			await recomputeEnrollmentCollectionState(enrollmentId);
		}
		return {
			ok: true,
			enrollmentId,
			alreadyConfirmed: true,
			contractStatus: enrollment.contractStatus,
		};
	}
	if (!enrollment.stripeCheckoutSessionId) {
		return { ok: false, reason: 'no_checkout_session' };
	}

	const session = await retrieveCheckoutSession(enrollment.stripeCheckoutSessionId);
	const result = await confirmPaidCheckout(session);

	if (result.ok && enrollment.stripeSubscriptionId) {
		await syncAllSubscriptionInvoices(enrollmentId);
	}

	return result;
}

/** Liens facture PDF / page hébergée pour le client (paiements payés uniquement). */
export async function listPaidInvoiceLinks(enrollmentId: string) {
	const payments = await getPrisma().payment.findMany({
		where: { enrollmentId, status: 'paid' },
		orderBy: { installmentNumber: 'asc' },
		select: {
			installmentNumber: true,
			invoicePdfUrl: true,
			hostedInvoiceUrl: true,
		},
	});

	return payments
		.map((payment) => {
			const url = payment.invoicePdfUrl ?? payment.hostedInvoiceUrl;
			if (!url) return null;
			return {
				installmentNumber: payment.installmentNumber,
				url,
			};
		})
		.filter((row): row is { installmentNumber: number; url: string } => Boolean(row));
}
