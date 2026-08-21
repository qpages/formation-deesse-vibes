import type { APIRoute } from 'astro';
import {
	parseCookie,
	TRACKING_COOKIE,
	verifyEnrollmentSessionToken,
} from '../../../../lib/auth/session';
import { json } from '../../../../lib/http';
import {
	ndaSignatureStepError,
	reconcileEnrollment,
	type NdaSignatureErrorReason,
} from '../../../../lib/enrollment/reconcile';
import { RATE_LIMITS, clientIp, enforceRateLimit, rateLimitKey } from '../../../../lib/rate-limit';

export const prerender = false;

const ERROR_STATUS: Record<NdaSignatureErrorReason, { status: number; message: string }> = {
	enrollment_not_found: { status: 404, message: 'Inscription introuvable.' },
	not_awaiting: { status: 409, message: 'Le contrat n’est pas en attente de signature.' },
	no_nda_request: {
		status: 400,
		message: 'Aucune demande de signature associée. Contactez un administrateur.',
	},
	provider_error: {
		status: 502,
		message: 'Impossible de vérifier la signature pour le moment. Réessaie dans quelques secondes.',
	},
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	try {
		const token = parseCookie(request.headers.get('cookie'), TRACKING_COOKIE);
		if (!token) {
			return json({ error: 'Session requise.' }, 401);
		}

		const enrollmentId = await verifyEnrollmentSessionToken(token);
		if (!enrollmentId) {
			return json({ error: 'Session invalide.' }, 401);
		}

		const limited = enforceRateLimit(
			rateLimitKey(RATE_LIMITS.ndaSync, [clientIp(request, clientAddress), enrollmentId]),
			RATE_LIMITS.ndaSync,
		);
		if (limited) return limited;

		const reconciled = await reconcileEnrollment(enrollmentId, 'client.nda_sync', 'nda_signature');
		const ndaStep = reconciled.steps.find((step) => step.step === 'nda_signature');
		if (!ndaStep || ndaStep.step !== 'nda_signature') {
			return json({ error: 'Échec de la vérification de signature.' }, 500);
		}
		const stepError = ndaSignatureStepError(ndaStep);
		if (stepError) {
			const mapped = ERROR_STATUS[stepError.reason];
			return json({ error: mapped.message, reason: stepError.reason }, mapped.status);
		}
		if (ndaStep.status === 'failed') {
			return json({ error: 'Échec de la vérification de signature.' }, 500);
		}

		if (!ndaStep.signed) {
			return json({
				ok: true,
				signed: false,
				message: 'La signature n’est pas encore enregistrée. Réessaie dans quelques secondes.',
			});
		}

		return json({ ok: true, signed: true });
	} catch (error) {
		console.error('[enrollment/nda-signature/refresh]', error);
		return json({ error: 'Échec de la vérification de signature.' }, 500);
	}
};
