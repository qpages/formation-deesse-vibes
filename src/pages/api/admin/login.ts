import type { APIRoute } from 'astro';
import { authenticateAdmin } from '../../../lib/auth/admin';
import { adminCookieOptions, createAdminSessionToken } from '../../../lib/auth/session';
import { json } from '../../../lib/http';
import { RATE_LIMITS, clientIp, enforceRateLimit, rateLimitKey } from '../../../lib/rate-limit';
import { notifyOps } from '../../../lib/services/slack';
import { adminLoginSchema } from '../../../lib/validation';

export const POST: APIRoute = async ({ request, clientAddress }) => {
	try {
		const body = await request.json();
		const parsed = adminLoginSchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: 'Identifiants invalides.' }, 400);
		}

		const limited = enforceRateLimit(
			rateLimitKey(RATE_LIMITS.adminLogin, [clientIp(request, clientAddress)]),
			RATE_LIMITS.adminLogin,
		);
		if (limited) return limited;

		const user = await authenticateAdmin(parsed.data.email, parsed.data.password);
		if (!user) {
			return json({ error: 'Accès refusé.' }, 401);
		}

		const token = await createAdminSessionToken(user.email);
		await notifyOps({
			kind: 'admin.login',
			severity: 'info',
			title: 'Connexion admin',
			email: user.email,
		});
		return json({ ok: true }, 200, {
			'Set-Cookie': adminCookieOptions(token),
		});
	} catch (error) {
		console.error('[admin/login]', error);
		return json({ error: 'Erreur de connexion.' }, 500);
	}
};
