import type { APIRoute } from 'astro';
import { json } from '../../../lib/http';
import { RATE_LIMITS, clientIp, enforceRateLimit, rateLimitKey } from '../../../lib/rate-limit';
import { requestMagicLink } from '../../../lib/enrollment';
import { formatErrorDetail, notifyOps } from '../../../lib/services/slack';
import { magicLinkSchema } from '../../../lib/validation';

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let email: string | undefined;
	try {
		const body = await request.json();
		const parsed = magicLinkSchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: parsed.error.issues[0]?.message ?? 'E-mail invalide' }, 400);
		}

		email = parsed.data.email;
		const limited = enforceRateLimit(
			rateLimitKey(RATE_LIMITS.magicLink, [clientIp(request, clientAddress), email]),
			RATE_LIMITS.magicLink,
		);
		if (limited) return limited;
		const result = await requestMagicLink(email);
		await notifyOps({
			kind: 'auth.magic_link_requested',
			severity: 'info',
			title: 'Demande de lien de connexion',
			email,
			detail: result.sent ? 'e-mail envoyé' : 'pas d’envoi (inconnu ou inscription pending)',
		});
		return json({
			ok: true,
			message:
				'Si une inscription correspond à cet e-mail, consultez votre boîte mail pour ouvrir le site.',
		});
	} catch (error) {
		console.error('[magic-link]', error);
		await notifyOps({
			kind: 'ops.api_error',
			severity: 'critical',
			title: 'POST /api/magic-link/request — 500',
			email,
			detail: formatErrorDetail(error),
		});
		return json({ error: 'Impossible d’envoyer le lien pour le moment.' }, 500);
	}
};
