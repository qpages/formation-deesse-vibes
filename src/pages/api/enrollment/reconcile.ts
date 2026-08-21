import type { APIRoute } from 'astro';
import {
	parseCookie,
	TRACKING_COOKIE,
	verifyEnrollmentSessionToken,
} from '../../../lib/auth/session';
import { findEnrollmentById } from '../../../lib/enrollment';
import { buildEnrollmentStatusPayload } from '../../../lib/enrollment/status-payload';
import { reconcileEnrollment } from '../../../lib/enrollment/reconcile';
import { json } from '../../../lib/http';
import { RATE_LIMITS, clientIp, enforceRateLimit, rateLimitKey } from '../../../lib/rate-limit';

export const prerender = false;

/**
 * Filet de progression piloté par le polling client.
 *
 * Le GET `/api/enrollment/status` ne fait que lire la base : si le webhook
 * Stripe ou signature n'arrive pas (ou tarde), l'état n'avance jamais sans un
 * rechargement complet (le SSR `resolveHomeEnrollment` reconcilie, pas le GET).
 * Ce POST rejoue la même réconciliation idempotente que le SSR pour que la page
 * progresse automatiquement, puis renvoie le payload de statut à jour.
 */
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
			rateLimitKey(RATE_LIMITS.statusPoll, [clientIp(request, clientAddress), enrollmentId]),
			RATE_LIMITS.statusPoll,
		);
		if (limited) return limited;

		try {
			await reconcileEnrollment(enrollmentId, 'client.status_poll', 'full');
		} catch (error) {
			// La réconciliation est un filet best-effort : un échec provider ne doit
			// pas empêcher de renvoyer l'état courant pour le polling.
			console.error('[enrollment/reconcile]', error);
		}

		const enrollment = await findEnrollmentById(enrollmentId);
		if (!enrollment) {
			return json({ error: 'Inscription introuvable.' }, 404);
		}

		const payload = await buildEnrollmentStatusPayload(enrollment);
		return json(payload, 200, { 'Cache-Control': 'no-store' });
	} catch (error) {
		console.error('[enrollment/reconcile]', error);
		return json({ error: 'Réconciliation impossible.' }, 500);
	}
};
