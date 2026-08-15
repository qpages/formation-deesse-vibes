import type Stripe from 'stripe';
import { decryptPayload } from '../crypto';
import {
	findEnrollmentByCheckoutSession,
	findEnrollmentById,
	findEnrollmentByScheduleId,
	findEnrollmentBySubscriptionId,
	findEnrollmentIdByPaymentIntentId,
	findEnrollmentIdByStripeInvoiceId,
} from './enrollment';
import {
	confirmPaidCheckout,
	ensureNdaAfterPayment,
	markEnrollmentRefunded,
	markSubscriptionScheduleCompleted,
	syncStripeInvoice,
	syncSubscriptionState,
} from './payments';

const PAID_CHECKOUT_EVENTS = new Set([
	'checkout.session.completed',
	'checkout.session.async_payment_succeeded',
]);

const HANDLED = new Set([
	...PAID_CHECKOUT_EVENTS,
	'invoice.paid',
	'invoice.payment_failed',
	'invoice.payment_action_required',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'subscription_schedule.completed',
	'charge.refunded',
	'charge.dispute.created',
]);

export function isHandledStripeEventType(eventType: string) {
	return HANDLED.has(eventType);
}

/**
 * Corrélation enrollment : metadata enrollmentId d’abord, jamais email seul.
 */
export async function resolveEnrollmentFromStripeObject(object: unknown): Promise<string | null> {
	const obj = object as Record<string, unknown>;
	const meta = obj.metadata as Stripe.Metadata | null | undefined;
	if (meta?.enrollmentId) {
		const byMeta = await findEnrollmentById(meta.enrollmentId);
		if (byMeta) return byMeta.id;
	}

	if (obj.object === 'checkout.session' && typeof obj.id === 'string') {
		const bySession = await findEnrollmentByCheckoutSession(obj.id);
		if (bySession) return bySession.id;
		if (typeof obj.client_reference_id === 'string') {
			const byRef = await findEnrollmentById(obj.client_reference_id);
			if (byRef) return byRef.id;
		}
	}

	if (obj.object === 'subscription' && typeof obj.id === 'string') {
		const bySub = await findEnrollmentBySubscriptionId(obj.id);
		if (bySub) return bySub.id;
	}

	if (obj.object === 'subscription_schedule' && typeof obj.id === 'string') {
		const bySchedule = await findEnrollmentByScheduleId(obj.id);
		if (bySchedule) return bySchedule.id;
	}

	if (obj.object === 'invoice') {
		if (typeof obj.id === 'string') {
			const byPayment = await findEnrollmentIdByStripeInvoiceId(obj.id);
			if (byPayment) return byPayment;
		}
		const sub = obj.subscription;
		const subId = typeof sub === 'string' ? sub : (sub as { id?: string } | null)?.id;
		if (subId) {
			const bySub = await findEnrollmentBySubscriptionId(subId);
			if (bySub) return bySub.id;
		}
	}

	return null;
}

function stripeRefId(ref: unknown): string | undefined {
	if (!ref) return undefined;
	if (typeof ref === 'string') return ref;
	if (typeof ref === 'object' && 'id' in ref && typeof (ref as { id: unknown }).id === 'string') {
		return (ref as { id: string }).id;
	}
	return undefined;
}

/** Corrélation refund/dispute : metadata.enrollmentId d'abord, sinon PaymentIntent. */
async function resolveEnrollmentIdFromPaymentIntent(
	metadata: Stripe.Metadata | null | undefined,
	paymentIntentRef: unknown,
): Promise<string | null> {
	if (metadata?.enrollmentId) {
		const byMeta = await findEnrollmentById(metadata.enrollmentId);
		if (byMeta) return byMeta.id;
	}
	const paymentIntentId = stripeRefId(paymentIntentRef);
	if (paymentIntentId) {
		return findEnrollmentIdByPaymentIntentId(paymentIntentId);
	}
	return null;
}

export async function handleStripeProviderEvent(input: {
	providerEventId: string;
	eventType: string;
	payloadCipherText: string | null;
}): Promise<{ enrollmentId?: string; ignored?: boolean }> {
	if (!isHandledStripeEventType(input.eventType)) {
		return { ignored: true };
	}

	if (!input.payloadCipherText) {
		throw new Error('ProviderEvent sans payload');
	}

	const raw = JSON.parse(decryptPayload(input.payloadCipherText)) as {
		type: string;
		data: { object: Stripe.Event.Data.Object };
		id: string;
	};

	const eventType = input.eventType;
	const object = raw.data.object;

	if (PAID_CHECKOUT_EVENTS.has(eventType)) {
		const session = object as Stripe.Checkout.Session;
		const result = await confirmPaidCheckout(session);
		if (!result.ok && result.reason.startsWith('payment_status=')) {
			return { enrollmentId: session.metadata?.enrollmentId, ignored: true };
		}
		if (!result.ok) throw new Error(result.reason);
		// NDA enqueue = post-condition de confirmPaidCheckout (pas ici).
		return { enrollmentId: result.enrollmentId };
	}

	if (eventType === 'invoice.paid') {
		const invoice = object as Stripe.Invoice;
		const result = await syncStripeInvoice(invoice);
		if (!result.ok && result.reason === 'enrollment_not_found') {
			return { ignored: true };
		}
		if (!result.ok) throw new Error(result.reason);
		await ensureNdaAfterPayment(result.enrollmentId, invoice.id ?? input.providerEventId, {
			soft: true,
		});
		return { enrollmentId: result.enrollmentId };
	}

	if (eventType === 'invoice.payment_failed' || eventType === 'invoice.payment_action_required') {
		const invoice = object as Stripe.Invoice;
		const result = await syncStripeInvoice(invoice, {
			forceStatus: eventType === 'invoice.payment_failed' ? 'failed' : 'open',
		});
		if (!result.ok && result.reason === 'enrollment_not_found') {
			return { ignored: true };
		}
		if (!result.ok) throw new Error(result.reason);
		return { enrollmentId: result.enrollmentId };
	}

	if (
		eventType === 'customer.subscription.updated' ||
		eventType === 'customer.subscription.deleted'
	) {
		const subscription = object as Stripe.Subscription;
		const result = await syncSubscriptionState(subscription);
		if (!result.ok) return { ignored: true };
		return { enrollmentId: result.enrollmentId };
	}

	if (eventType === 'subscription_schedule.completed') {
		const schedule = object as Stripe.SubscriptionSchedule;
		const result = await markSubscriptionScheduleCompleted(schedule);
		if (!result.ok) return { ignored: true };
		return { enrollmentId: result.enrollmentId };
	}

	if (eventType === 'charge.refunded') {
		const charge = object as Stripe.Charge;
		// Refund partiel : on ne révoque pas (reste dû / déjà encaissé en partie).
		if (!charge.refunded) return { ignored: true };
		const enrollmentId = await resolveEnrollmentIdFromPaymentIntent(
			charge.metadata,
			charge.payment_intent,
		);
		if (!enrollmentId) return { ignored: true };
		const result = await markEnrollmentRefunded(enrollmentId, 'refund');
		if (!result.ok) return { ignored: true };
		return { enrollmentId: result.enrollmentId };
	}

	if (eventType === 'charge.dispute.created') {
		const dispute = object as Stripe.Dispute;
		const enrollmentId = await resolveEnrollmentIdFromPaymentIntent(
			dispute.metadata,
			dispute.payment_intent,
		);
		if (!enrollmentId) return { ignored: true };
		const result = await markEnrollmentRefunded(enrollmentId, 'dispute');
		if (!result.ok) return { ignored: true };
		return { enrollmentId: result.enrollmentId };
	}

	return { ignored: true };
}

/** Store full Stripe event JSON for the process job (called from thin webhook). */
export function stripeEventPayload(event: Stripe.Event) {
	return {
		id: event.id,
		type: event.type,
		data: { object: event.data.object },
	};
}
