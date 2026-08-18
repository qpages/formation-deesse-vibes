import type { APIRoute } from 'astro';
import {
	parseCookie,
	TRACKING_COOKIE,
	verifyEnrollmentSessionToken,
} from '../../../lib/auth/session';
import { json } from '../../../lib/http';
import { RATE_LIMITS, clientIp, enforceRateLimit, rateLimitKey } from '../../../lib/rate-limit';
import { getSignedNdaPdf, toSignedNdaResponse } from '../../../lib/services/nda-download';

export const prerender = false;

export const GET: APIRoute = async ({ request, clientAddress }) => {
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
			rateLimitKey(RATE_LIMITS.ndaDownload, [clientIp(request, clientAddress), enrollmentId]),
			RATE_LIMITS.ndaDownload,
		);
		if (limited) return limited;

		const result = await getSignedNdaPdf(enrollmentId);
		if (!result.ok && result.reason === 'yousign_error') {
			console.error('[enrollment/nda]', result.detail);
		}
		return toSignedNdaResponse(result);
	} catch (error) {
		console.error('[enrollment/nda]', error);
		return json({ error: 'Échec du téléchargement du contrat.' }, 500);
	}
};
