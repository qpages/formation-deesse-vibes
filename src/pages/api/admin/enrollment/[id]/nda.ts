import type { APIRoute } from 'astro';
import { json, requireAdminApi } from '../../../../../lib/admin/auth';
import {
	RATE_LIMITS,
	clientIp,
	enforceRateLimit,
	rateLimitKey,
} from '../../../../../lib/rate-limit';
import { getSignedNdaPdf, toSignedNdaResponse } from '../../../../../lib/services/nda-download';

export const prerender = false;

export const GET: APIRoute = async ({ params, request, clientAddress }) => {
	try {
		const admin = await requireAdminApi(request);
		if (admin instanceof Response) return admin;

		const enrollmentId = params.id;
		if (!enrollmentId) {
			return json({ error: 'Identifiant manquant.' }, 400);
		}

		const limited = enforceRateLimit(
			rateLimitKey(RATE_LIMITS.ndaDownload, [
				clientIp(request, clientAddress),
				admin,
				enrollmentId,
			]),
			RATE_LIMITS.ndaDownload,
		);
		if (limited) return limited;

		const result = await getSignedNdaPdf(enrollmentId);
		if (!result.ok && result.reason === 'yousign_error') {
			console.error('[admin/enrollment/nda]', result.detail);
		}
		return toSignedNdaResponse(result);
	} catch (error) {
		console.error('[admin/enrollment/nda]', error);
		return json({ error: 'Échec du téléchargement du contrat.' }, 500);
	}
};
