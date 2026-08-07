import type { APIRoute } from 'astro';
import {
	parseCookie,
	TRACKING_COOKIE,
	verifyEnrollmentSessionToken,
} from '../../../lib/auth/session';
import { json } from '../../../lib/http';
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

	return json(
		{
			collectionStatus: enrollment.collectionStatus,
			contractStatus: enrollment.contractStatus,
			accessStatus: enrollment.accessStatus,
		},
		200,
		{ 'Cache-Control': 'no-store' },
	);
};
