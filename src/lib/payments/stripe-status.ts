import type Stripe from 'stripe';
import type { SubscriptionStatus } from '../../generated/prisma/client';

const SUBSCRIPTION_STATUSES = [
	'incomplete',
	'incomplete_expired',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused',
] as const satisfies readonly SubscriptionStatus[];

export function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
	if ((SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
		return status as SubscriptionStatus;
	}
	throw new Error(`Unknown Stripe subscription status: ${status}`);
}
