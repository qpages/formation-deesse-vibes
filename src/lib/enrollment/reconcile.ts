import { isAwaitingNda } from '../enrollment-gates';
import { getPrisma } from '../prisma';
import { confirmPaidCheckout } from '../payments/checkout';
import { ensureNdaAfterPayment } from '../payments/nda-trigger';
import { hydrateInvoiceUrls } from '../payments/invoice-links';
import { recomputeEnrollmentCollectionState } from '../payments/invoice-sync';
import { syncAllSubscriptionInvoices } from '../payments/subscription-sync';
import { retrieveCheckoutSession } from '../stripe';
import { isNdaFullyProvisioned } from '../signature/helpers';
import { applyAccessPolicy } from './access';
import { confirmNdaSignature } from './confirm-nda-signature';
import { findEnrollmentById } from './queries';

export type ReconcileTriggerSource =
	| 'webhook.stripe'
	| 'webhook.signature'
	| 'page.home'
	| 'admin.sync_payment'
	| 'admin.sync_nda'
	| 'client.nda_sync'
	| 'client.status_poll'
	| 'checkout.start'
	| 'cron.access_policy';

export type ReconcileTrigger =
	ReconcileTriggerSource | { source: ReconcileTriggerSource; sessionId?: string | null };

export type ReconcileScope = 'full' | 'payment' | 'nda_provision' | 'nda_signature' | 'access_only';

export type ReconcileStepName = 'payment' | 'nda_provision' | 'nda_signature' | 'access';

export type ReconcileStepResult =
	| {
			step: 'payment';
			status: 'ok' | 'skipped' | 'failed';
			alreadyConfirmed?: boolean;
			reason?: string;
	  }
	| {
			step: 'nda_provision';
			status: 'ok' | 'skipped' | 'failed';
			enqueueStatus?: string;
	  }
	| {
			step: 'nda_signature';
			status: 'ok' | 'skipped' | 'failed';
			signed?: boolean;
			reason?: string;
			followUpFailed?: boolean;
	  }
	| {
			step: 'access';
			status: 'ok' | 'skipped' | 'failed';
			emitted?: 'grant' | 'suspend' | 'revoke' | null;
	  };

export type ReconcileResult = {
	enrollmentId: string;
	trigger: ReconcileTriggerSource;
	scope: ReconcileScope;
	steps: ReconcileStepResult[];
	mutated: boolean;
};

export type NdaSignatureErrorReason =
	'enrollment_not_found' | 'not_awaiting' | 'no_nda_request' | 'provider_error';

const NDA_SIGNATURE_ERROR_REASONS = new Set<NdaSignatureErrorReason>([
	'enrollment_not_found',
	'not_awaiting',
	'no_nda_request',
	'provider_error',
]);

/** reconcile returns some client errors as `skipped`, not only `failed`. */
export function ndaSignatureStepError(
	step: ReconcileStepResult | undefined,
): { reason: NdaSignatureErrorReason } | null {
	if (!step || step.step !== 'nda_signature' || !step.reason) return null;
	if (step.status !== 'failed' && step.status !== 'skipped') return null;
	if (!NDA_SIGNATURE_ERROR_REASONS.has(step.reason as NdaSignatureErrorReason)) return null;
	return { reason: step.reason as NdaSignatureErrorReason };
}

function resolveTriggerSource(trigger: ReconcileTrigger): ReconcileTriggerSource {
	return typeof trigger === 'string' ? trigger : trigger.source;
}

function resolveSessionId(
	trigger: ReconcileTrigger,
	enrollment: Awaited<ReturnType<typeof findEnrollmentById>>,
): string | null {
	if (typeof trigger === 'object' && trigger.sessionId) {
		return trigger.sessionId;
	}
	return enrollment?.stripeCheckoutSessionId ?? null;
}

function isWebhookStripe(source: ReconcileTriggerSource): boolean {
	return source === 'webhook.stripe';
}

function stepInScope(scope: ReconcileScope, step: ReconcileStepName): boolean {
	if (scope === 'full') return true;
	if (scope === 'access_only') return step === 'access';
	return scope === step;
}

async function runAdminPaymentRepair(enrollmentId: string): Promise<ReconcileStepResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { step: 'payment', status: 'failed', reason: 'enrollment_not_found' };
	}

	if (enrollment.stripeSubscriptionId) {
		await syncAllSubscriptionInvoices(enrollmentId);
	} else {
		const payments = await getPrisma().payment.findMany({
			where: { enrollmentId },
			orderBy: { installmentNumber: 'asc' },
		});
		await hydrateInvoiceUrls(payments);
		await recomputeEnrollmentCollectionState(enrollmentId);
	}

	return { step: 'payment', status: 'ok', alreadyConfirmed: true };
}

async function runPaymentStep(
	enrollmentId: string | undefined,
	trigger: ReconcileTrigger,
	source: ReconcileTriggerSource,
): Promise<{
	step: ReconcileStepResult;
	enrollmentId: string;
	ranConfirm: boolean;
	mutated: boolean;
	paymentAlreadyConfirmed: boolean;
}> {
	let resolvedId = enrollmentId;
	const enrollment = resolvedId ? await findEnrollmentById(resolvedId) : null;
	const sessionId = resolveSessionId(trigger, enrollment);

	if (source === 'admin.sync_payment' && enrollment && enrollment.collectionStatus !== 'pending') {
		const step = await runAdminPaymentRepair(enrollment.id);
		return {
			step,
			enrollmentId: enrollment.id,
			ranConfirm: false,
			mutated: false,
			paymentAlreadyConfirmed: true,
		};
	}

	const checkoutToSync =
		sessionId ??
		(enrollment?.collectionStatus === 'pending' ? enrollment.stripeCheckoutSessionId : null);

	if (!checkoutToSync || (enrollment && enrollment.collectionStatus !== 'pending')) {
		if (!resolvedId) {
			return {
				step: { step: 'payment', status: 'skipped', reason: 'no_checkout_session' },
				enrollmentId: resolvedId ?? '',
				ranConfirm: false,
				mutated: false,
				paymentAlreadyConfirmed: false,
			};
		}
		return {
			step: {
				step: 'payment',
				status: 'skipped',
				reason:
					enrollment?.collectionStatus !== 'pending' ? 'already_confirmed' : 'no_checkout_session',
			},
			enrollmentId: resolvedId,
			ranConfirm: false,
			mutated: false,
			paymentAlreadyConfirmed: enrollment?.collectionStatus !== 'pending',
		};
	}

	const stripeSession = await retrieveCheckoutSession(checkoutToSync);
	resolvedId =
		stripeSession.metadata?.enrollmentId ??
		stripeSession.client_reference_id ??
		resolvedId ??
		undefined;

	if (!resolvedId) {
		return {
			step: { step: 'payment', status: 'failed', reason: 'no_enrollment_id' },
			enrollmentId: '',
			ranConfirm: false,
			mutated: false,
			paymentAlreadyConfirmed: false,
		};
	}

	const confirmed = await confirmPaidCheckout(stripeSession, {
		softEnqueue: !isWebhookStripe(source),
	});

	if (!confirmed.ok) {
		return {
			step: { step: 'payment', status: 'skipped', reason: confirmed.reason },
			enrollmentId: resolvedId,
			ranConfirm: true,
			mutated: false,
			paymentAlreadyConfirmed: false,
		};
	}

	if (source === 'admin.sync_payment') {
		const fresh = await findEnrollmentById(resolvedId);
		if (fresh?.stripeSubscriptionId) {
			await syncAllSubscriptionInvoices(resolvedId);
		}
	}

	return {
		step: {
			step: 'payment',
			status: 'ok',
			alreadyConfirmed: confirmed.alreadyConfirmed,
		},
		enrollmentId: confirmed.enrollmentId,
		ranConfirm: true,
		mutated: !confirmed.alreadyConfirmed,
		paymentAlreadyConfirmed: confirmed.alreadyConfirmed,
	};
}

async function runNdaProvisionStep(
	enrollmentId: string,
	source: ReconcileTriggerSource,
): Promise<ReconcileStepResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { step: 'nda_provision', status: 'failed' };
	}
	if (!isAwaitingNda(enrollment)) {
		return { step: 'nda_provision', status: 'skipped', enqueueStatus: 'not_awaiting' };
	}
	if (isNdaFullyProvisioned(enrollment)) {
		return { step: 'nda_provision', status: 'skipped', enqueueStatus: 'already_provisioned' };
	}

	const sourceId = enrollment.stripeCheckoutSessionId ?? `${source}:${enrollmentId}`;

	const result = await ensureNdaAfterPayment(enrollmentId, sourceId, {
		soft: !isWebhookStripe(source),
	});

	return {
		step: 'nda_provision',
		status: result.status === 'failed' ? 'failed' : 'ok',
		enqueueStatus: result.status,
	};
}

async function runNdaSignatureStep(
	enrollmentId: string,
): Promise<Extract<ReconcileStepResult, { step: 'nda_signature' }>> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { step: 'nda_signature', status: 'failed', reason: 'enrollment_not_found' };
	}
	if (!isAwaitingNda(enrollment)) {
		return { step: 'nda_signature', status: 'skipped', reason: 'not_awaiting' };
	}

	const result = await confirmNdaSignature(enrollmentId);
	if (!result.ok) {
		if (result.reason === 'no_nda_request') {
			return {
				step: 'nda_signature',
				status: 'skipped',
				reason: result.reason,
			};
		}
		return {
			step: 'nda_signature',
			status: 'failed',
			reason: result.reason,
		};
	}

	return {
		step: 'nda_signature',
		status: 'ok',
		signed: result.signed,
		followUpFailed: result.signed && result.followUp?.status === 'failed',
	};
}

async function runAccessStep(enrollmentId: string): Promise<ReconcileStepResult> {
	const result = await applyAccessPolicy(enrollmentId);
	return {
		step: 'access',
		status: 'ok',
		emitted: result.emitted,
	};
}

/**
 * Orchestration centralisée des filets de réconciliation.
 * Délègue aux primitives idempotentes existantes ; ne remplace pas les webhooks.
 */
export async function reconcileEnrollment(
	enrollmentId: string | undefined,
	trigger: ReconcileTrigger,
	scope: ReconcileScope = 'full',
): Promise<ReconcileResult> {
	const source = resolveTriggerSource(trigger);
	const steps: ReconcileStepResult[] = [];
	let mutated = false;
	let resolvedEnrollmentId = enrollmentId ?? '';
	let paymentRanConfirm = false;
	let paymentAlreadyConfirmed = false;

	if (stepInScope(scope, 'payment')) {
		const payment = await runPaymentStep(enrollmentId, trigger, source);
		steps.push(payment.step);
		if (payment.enrollmentId) {
			resolvedEnrollmentId = payment.enrollmentId;
		}
		paymentRanConfirm = payment.ranConfirm;
		paymentAlreadyConfirmed = payment.paymentAlreadyConfirmed;
		mutated ||= payment.mutated;
	}

	if (!resolvedEnrollmentId) {
		console.info('[reconcile]', { enrollmentId, trigger: source, scope, steps });
		return { enrollmentId: '', trigger: source, scope, steps, mutated };
	}

	if (stepInScope(scope, 'nda_provision')) {
		const ndaProvision = await runNdaProvisionStep(resolvedEnrollmentId, source);
		steps.push(ndaProvision);
	}

	if (stepInScope(scope, 'nda_signature')) {
		const ndaSignature = await runNdaSignatureStep(resolvedEnrollmentId);
		steps.push(ndaSignature);
		if (
			ndaSignature.step === 'nda_signature' &&
			ndaSignature.status === 'ok' &&
			ndaSignature.signed
		) {
			mutated = true;
		}
	}

	if (stepInScope(scope, 'access') && (!paymentRanConfirm || paymentAlreadyConfirmed)) {
		const access = await runAccessStep(resolvedEnrollmentId);
		steps.push(access);
		if (access.step === 'access' && access.emitted) {
			mutated = true;
		}
	}

	console.info('[reconcile]', {
		enrollmentId: resolvedEnrollmentId,
		trigger: source,
		scope,
		steps,
	});

	return {
		enrollmentId: resolvedEnrollmentId,
		trigger: source,
		scope,
		steps,
		mutated,
	};
}
