import type { APIRoute } from 'astro';
import {
	parseCookie,
	TRACKING_COOKIE,
	verifyEnrollmentSessionToken,
} from '../../../lib/auth/session';
import { json } from '../../../lib/http';
import { RATE_LIMITS, clientIp, enforceRateLimit, rateLimitKey } from '../../../lib/rate-limit';
import { confirmLearnerNdaSignature } from '../../../lib/signature/nda-sync';

export const prerender = false;

const ERROR_STATUS: Record<
	'enrollment_not_found' | 'not_awaiting' | 'no_nda_request' | 'provider_error',
	{ status: number; message: string }
> = {
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

		const result = await confirmLearnerNdaSignature(enrollmentId);
		if (!result.ok) {
			const mapped = ERROR_STATUS[result.reason];
			return json({ error: mapped.message, reason: result.reason }, mapped.status);
		}

		if (!result.signed) {
			return json({
				ok: true,
				signed: false,
				message: 'La signature n’est pas encore enregistrée. Réessaie dans quelques secondes.',
			});
		}

		return json({ ok: true, signed: true });
	} catch (error) {
		console.error('[enrollment/nda-sync]', error);
		return json({ error: 'Échec de la vérification de signature.' }, 500);
	}
};
