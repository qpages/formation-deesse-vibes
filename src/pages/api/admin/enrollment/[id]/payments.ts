import type { APIRoute } from 'astro';
import {
	ADMIN_COOKIE,
	parseCookie,
	verifyAdminSessionToken,
} from '../../../../../lib/auth/session';
import { getAdminPaymentSummary } from '../../../../../lib/admin/payments';

export const GET: APIRoute = async ({ params, request }) => {
	const adminEmail = await verifyAdminSessionToken(
		parseCookie(request.headers.get('cookie'), ADMIN_COOKIE) ?? '',
	);
	if (!adminEmail) {
		return json({ error: 'Non autorisé.' }, 401);
	}

	const enrollmentId = params.id;
	if (!enrollmentId) {
		return json({ error: 'Identifiant manquant.' }, 400);
	}

	const summary = await getAdminPaymentSummary(enrollmentId);
	if (!summary) {
		return json({ error: 'Inscription introuvable.' }, 404);
	}

	return json({ summary });
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
