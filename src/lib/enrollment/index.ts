export {
	applyAccessPolicy,
	evaluateAccess,
	type AccessDecision,
} from './access';

export {
	attachStripeCheckoutSession,
	createPendingEnrollment,
	DuplicateEnrollmentError,
	updateEnrollmentContractMirror,
} from './lifecycle';

export {
	consumeMagicLink,
	peekMagicLink,
	requestMagicLink,
	type MagicLinkLookup,
} from './magic-link';

export {
	canResendNda,
	markNdaResent,
	resolveNdaSignSurface,
} from './nda-resend';

export {
	markProviderEventFailed,
	markProviderEventIgnored,
	markProviderEventProcessed,
	purgeOldWebhookPayloads,
	recordProviderEvent,
	type RecordedProviderEvent,
} from './provider-events';

export type { EnrollmentWithUser } from './queries';
export {
	findEnrollmentByCheckoutSession,
	findEnrollmentByEmail,
	findEnrollmentByExternalRequestId,
	findEnrollmentByExternalRequestOrEnrollmentId,
	findEnrollmentById,
	findEnrollmentByIdOrThrow,
	findEnrollmentByScheduleId,
	findEnrollmentByScheduleOrSubscription,
	findEnrollmentBySubscriptionId,
	findEnrollmentForAccessPolicy,
	findEnrollmentIdByPaymentIntentId,
	findEnrollmentIdByStripeInvoiceId,
	withUser,
} from './queries';
