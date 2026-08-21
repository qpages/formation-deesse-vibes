import {
	createEnrollmentSessionToken,
	enrollmentCookieOptions,
	parseCookie,
	TRACKING_COOKIE,
	verifyEnrollmentSessionToken,
} from '../auth/session';
import { isAwaitingNda, isPaidEnough } from '../enrollment-gates';
import {
	consumeMagicLink,
	findEnrollmentByCheckoutSession,
	findEnrollmentById,
	peekMagicLink,
	resolveAwaitingNdaSignSurface,
	type EnrollmentWithUser,
} from '../enrollment';
import { reconcileEnrollment } from '../enrollment/reconcile';
import { getLearnerPaymentSchedule, type LearnerPaymentSchedule } from '../payments';
import { ensureNdaContractSentIfProvisioned } from '../signature/persist';
import { notifyOps } from '../services/slack';
import { checkoutSuccessFlash, stepStates } from '../status';
import type { SignSurface } from '../signature/types';
import {
	decideMagicLinkOutcome,
	MAGIC_LINK_CONNECTED_FLASH,
	MAGIC_LINK_INVALID_FLASH,
} from './magic-link-outcome';

export type HomeEnrollmentView = {
	enrollment: EnrollmentWithUser | null;
	flash: string | null;
	setCookie: string | null;
	checkoutCancel: boolean;
	awaitingWebhook: boolean;
	showFunnel: boolean;
	showTracking: boolean;
	steps: ReturnType<typeof stepStates>;
	ndaSignSurface: SignSurface | null;
	paymentSchedule: LearnerPaymentSchedule | null;
	magicLinkFailed: boolean;
};

export type HomeEnrollmentResult =
	| { kind: 'redirect'; redirectTo: string; setCookie: string | null }
	| { kind: 'confirm_magic_link'; token: string }
	| { kind: 'page'; view: HomeEnrollmentView };

async function cookieEnrollmentId(cookieHeader: string | null): Promise<string | null> {
	const cookieToken = parseCookie(cookieHeader, TRACKING_COOKIE);
	if (!cookieToken) return null;
	return verifyEnrollmentSessionToken(cookieToken);
}

export async function completeMagicLinkConsume(
	token: string,
	cookieHeader: string | null,
): Promise<{ redirectTo: string; setCookie: string | null }> {
	const lookup = await consumeMagicLink(token);
	const sessionEnrollmentId = await cookieEnrollmentId(cookieHeader);
	const outcome = decideMagicLinkOutcome(lookup, sessionEnrollmentId);

	if (outcome.action !== 'set_session') {
		return { redirectTo: outcome.redirectTo, setCookie: null };
	}

	const enrollment = await findEnrollmentById(outcome.enrollmentId);
	await notifyOps({
		kind: 'auth.magic_link_consumed',
		severity: 'info',
		title: 'Connexion via lien magique',
		enrollmentId: outcome.enrollmentId,
		email: enrollment?.user.email,
	});
	return {
		redirectTo: outcome.redirectTo,
		setCookie: enrollmentCookieOptions(await createEnrollmentSessionToken(outcome.enrollmentId)),
	};
}

/** Orchestration page d’accueil : session, reconcile Checkout, NDA, factures. */
export async function resolveHomeEnrollment(input: {
	cookieHeader: string | null;
	token: string | null;
	sessionId: string | null;
	checkout: string | null;
	connected: string | null;
	link: string | null;
}): Promise<HomeEnrollmentResult> {
	const { cookieHeader, token, sessionId, checkout, connected, link } = input;

	let enrollment: EnrollmentWithUser | null = null;
	let flash: string | null = null;
	let setCookie: string | null = null;

	try {
		if (token) {
			const lookup = await peekMagicLink(token);
			const sessionEnrollmentId = await cookieEnrollmentId(cookieHeader);
			const outcome = decideMagicLinkOutcome(lookup, sessionEnrollmentId);
			if (outcome.action === 'set_session') {
				return { kind: 'confirm_magic_link', token };
			}
			return { kind: 'redirect', redirectTo: outcome.redirectTo, setCookie: null };
		}

		if (!enrollment && sessionId) {
			enrollment = await findEnrollmentByCheckoutSession(sessionId);
			if (enrollment) {
				const sessionToken = await createEnrollmentSessionToken(enrollment.id);
				setCookie = enrollmentCookieOptions(sessionToken);
			}
		}

		if (!enrollment) {
			const enrollmentId = await cookieEnrollmentId(cookieHeader);
			if (enrollmentId) {
				enrollment = await findEnrollmentById(enrollmentId);
			}
		}

		const checkoutToSync =
			sessionId ??
			(enrollment?.collectionStatus === 'pending' ? enrollment.stripeCheckoutSessionId : null);

		if (enrollment || checkoutToSync) {
			try {
				const reconciled = await reconcileEnrollment(
					enrollment?.id,
					{ source: 'page.home', sessionId: checkoutToSync },
					'full',
				);
				if (reconciled.enrollmentId) {
					const paymentConfirmed = reconciled.steps.some(
						(s) => s.step === 'payment' && s.status === 'ok' && s.alreadyConfirmed === false,
					);
					if (!enrollment) {
						enrollment = await findEnrollmentById(reconciled.enrollmentId);
						if (enrollment) {
							setCookie = enrollmentCookieOptions(
								await createEnrollmentSessionToken(enrollment.id),
							);
						}
					} else if (reconciled.mutated) {
						enrollment = await findEnrollmentById(enrollment.id);
					}
					if (enrollment && !setCookie && paymentConfirmed) {
						setCookie = enrollmentCookieOptions(await createEnrollmentSessionToken(enrollment.id));
					}
				}
			} catch (error) {
				console.error('[index] reconcile', error);
			}
		}

		if (checkout === 'success' && enrollment) {
			flash = checkoutSuccessFlash({
				collectionStatus: enrollment.collectionStatus,
				contractStatus: enrollment.contractStatus,
				accessStatus: enrollment.accessStatus,
			});
		} else if (connected === '1') {
			flash = MAGIC_LINK_CONNECTED_FLASH;
		} else if (link === 'invalid') {
			flash = MAGIC_LINK_INVALID_FLASH;
		}
	} catch (error) {
		console.error('[index] enrollment lookup', error);
	}

	const checkoutCancel = checkout === 'cancel';

	const awaitingWebhook =
		!checkoutCancel &&
		enrollment?.collectionStatus === 'pending' &&
		Boolean(enrollment.stripeCheckoutSessionId);

	const showFunnel =
		!enrollment ||
		enrollment.collectionStatus === 'refunded' ||
		enrollment.accessStatus === 'revoked' ||
		(enrollment.collectionStatus === 'pending' && !enrollment.stripeCheckoutSessionId);

	const showTracking = !checkoutCancel && Boolean(enrollment) && (!showFunnel || awaitingWebhook);

	const steps = enrollment
		? stepStates({
				collectionStatus: enrollment.collectionStatus,
				contractStatus: enrollment.contractStatus,
				accessStatus: enrollment.accessStatus,
			})
		: { paiement: 'a_faire' as const, nda: 'a_faire' as const, acces: 'a_faire' as const };

	if (enrollment && isAwaitingNda(enrollment)) {
		const fresh = await findEnrollmentById(enrollment.id);
		if (fresh) {
			enrollment = await ensureNdaContractSentIfProvisioned(fresh);
		}
	}

	const ndaSignSurface =
		enrollment && isAwaitingNda(enrollment)
			? await resolveAwaitingNdaSignSurface(enrollment)
			: null;

	const paymentSchedule =
		enrollment && isPaidEnough(enrollment.collectionStatus)
			? await getLearnerPaymentSchedule(enrollment.id)
			: null;

	return {
		kind: 'page',
		view: {
			enrollment,
			flash,
			setCookie,
			checkoutCancel,
			awaitingWebhook,
			showFunnel,
			showTracking,
			steps,
			ndaSignSurface,
			paymentSchedule,
			magicLinkFailed: link === 'invalid',
		},
	};
}
