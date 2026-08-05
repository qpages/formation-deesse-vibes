import type { APIRoute } from 'astro';
import {
	parseCookie,
	TRACKING_COOKIE,
	verifyEnrollmentSessionToken,
} from '../../../lib/auth/session';
import { findEnrollmentById } from '../../../lib/services/enrollment';

export const GET: APIRoute = async ({ request }) => {
	const token = parseCookie(request.headers.get('cookie'), TRACKING_COOKIE);
	if (!token) {
		return json({ error: 'Session requise.' }, 401);
	}

	const enrollmentId = await verifyEnrollmentSessionToken(token);
	if (!enrollmentId) {
		return json({ error: 'Session invalide.' }, 401);
	}

	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return json({ error: 'Inscription introuvable.' }, 404);
	}

	return json({ status: enrollment.status });
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	});
}
