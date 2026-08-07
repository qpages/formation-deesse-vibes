import type { APIRoute } from 'astro';
import { json, requireAdminApi } from '../../../../../lib/admin/auth';
import { getAdminPaymentSummary } from '../../../../../lib/admin/payments';

export const GET: APIRoute = async ({ params, request }) => {
	const admin = await requireAdminApi(request);
	if (admin instanceof Response) return admin;

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
