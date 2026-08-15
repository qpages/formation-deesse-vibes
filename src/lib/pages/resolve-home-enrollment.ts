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
	resolveNdaSignUrl,
	type EnrollmentWithUser,
} from '../services/enrollment';
import {
	confirmPaidCheckout,
	ensureNdaAfterPayment,
	listPaidInvoiceLinks,
	retrieveCheckoutSession,
} from '../services/payments';
import { notifyOps } from '../services/slack';
import { checkoutSuccessFlash, stepStates } from '../status';
import { isNdaFullyProvisioned } from '../yousign';
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
	ndaSignUrl: string | null;
	invoiceLinks: Awaited<ReturnType<typeof listPaidInvoiceLinks>>;
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

		// Filet : Stripe a encaissé mais le webhook a loupé
		const checkoutToSync =
			sessionId ??
			(enrollment?.collectionStatus === 'pending' ? enrollment.stripeCheckoutSessionId : null);
		if (checkoutToSync && (!enrollment || enrollment.collectionStatus === 'pending')) {
			try {
				const stripeSession = await retrieveCheckoutSession(checkoutToSync);
				const confirmed = await confirmPaidCheckout(stripeSession);
				if (confirmed.ok) {
					enrollment = await findEnrollmentById(confirmed.enrollmentId);
					if (enrollment && !setCookie) {
						setCookie = enrollmentCookieOptions(await createEnrollmentSessionToken(enrollment.id));
					}
				}
			} catch (error) {
				console.error('[index] checkout reconcile', error);
			}
		}

		// Filet 2 : payé en DB, NDA jamais enqueue (ex. confirm avant ce fix)
		if (enrollment && isAwaitingNda(enrollment) && !isNdaFullyProvisioned(enrollment)) {
			try {
				await ensureNdaAfterPayment(
					enrollment.id,
					enrollment.stripeCheckoutSessionId ?? `page-reconcile:${enrollment.id}`,
				);
			} catch (error) {
				console.error('[index] nda reconcile', error);
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

	let ndaSignUrl: string | null = null;
	if (enrollment && isAwaitingNda(enrollment)) {
		try {
			ndaSignUrl = await resolveNdaSignUrl(enrollment);
		} catch {
			ndaSignUrl = null;
		}
	}

	const invoiceLinks =
		enrollment && isPaidEnough(enrollment.collectionStatus)
			? await listPaidInvoiceLinks(enrollment.id)
			: [];

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
			ndaSignUrl,
			invoiceLinks,
			magicLinkFailed: link === 'invalid',
		},
	};
}
