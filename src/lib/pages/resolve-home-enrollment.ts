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
	resolveNdaSignUrl,
	type EnrollmentWithUser,
} from '../services/enrollment';
import {
	confirmPaidCheckout,
	listPaidInvoiceLinks,
	retrieveCheckoutSession,
} from '../services/payments';
import { checkoutSuccessFlash, stepStates } from '../status';

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

/** Orchestration page d’accueil : session, reconcile Checkout, NDA, factures. */
export async function resolveHomeEnrollment(input: {
	cookieHeader: string | null;
	token: string | null;
	sessionId: string | null;
	checkout: string | null;
}): Promise<HomeEnrollmentView> {
	const { cookieHeader, token, sessionId, checkout } = input;

	let enrollment: EnrollmentWithUser | null = null;
	let flash: string | null = null;
	let setCookie: string | null = null;

	try {
		if (token) {
			enrollment = await consumeMagicLink(token);
			if (enrollment) {
				const sessionToken = await createEnrollmentSessionToken(enrollment.id);
				setCookie = enrollmentCookieOptions(sessionToken);
				flash = 'Lien magique validé. Voici l’état de votre inscription.';
			} else {
				flash = 'Ce lien est invalide ou a expiré. Demandez-en un nouveau ci-dessous.';
			}
		}

		if (!enrollment && sessionId) {
			enrollment = await findEnrollmentByCheckoutSession(sessionId);
			if (enrollment) {
				const sessionToken = await createEnrollmentSessionToken(enrollment.id);
				setCookie = enrollmentCookieOptions(sessionToken);
			}
		}

		if (!enrollment) {
			const cookieToken = parseCookie(cookieHeader, TRACKING_COOKIE);
			if (cookieToken) {
				const enrollmentId = await verifyEnrollmentSessionToken(cookieToken);
				if (enrollmentId) {
					enrollment = await findEnrollmentById(enrollmentId);
				}
			}
		}

		// Filet : Stripe a encaissé mais le webhook a loupé
		const checkoutToSync =
			sessionId ??
			(enrollment?.collectionStatus === 'pending'
				? enrollment.stripeCheckoutSessionId
				: null);
		if (checkoutToSync && (!enrollment || enrollment.collectionStatus === 'pending')) {
			try {
				const stripeSession = await retrieveCheckoutSession(checkoutToSync);
				const confirmed = await confirmPaidCheckout(stripeSession);
				if (confirmed.ok) {
					enrollment = await findEnrollmentById(confirmed.enrollmentId);
					if (enrollment && !setCookie) {
						setCookie = enrollmentCookieOptions(
							await createEnrollmentSessionToken(enrollment.id),
						);
					}
				}
			} catch (error) {
				console.error('[index] checkout reconcile', error);
			}
		}

		if (checkout === 'success' && enrollment) {
			flash = checkoutSuccessFlash({
				collectionStatus: enrollment.collectionStatus,
				contractStatus: enrollment.contractStatus,
				accessStatus: enrollment.accessStatus,
			});
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

	const showTracking =
		!checkoutCancel && Boolean(enrollment) && (!showFunnel || awaitingWebhook);

	const steps = enrollment
		? stepStates({
				collectionStatus: enrollment.collectionStatus,
				contractStatus: enrollment.contractStatus,
				accessStatus: enrollment.accessStatus,
			})
		: { paiement: 'a_faire' as const, nda: 'a_faire' as const, acces: 'a_faire' as const };

	let ndaSignUrl: string | null = null;
	if (
		enrollment &&
		isAwaitingNda(enrollment)
	) {
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
		magicLinkFailed: Boolean(token && !enrollment),
	};
}
