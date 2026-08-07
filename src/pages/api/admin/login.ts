import type { APIRoute } from 'astro';
import { authenticateAdmin } from '../../../lib/auth/admin';
import { adminCookieOptions, createAdminSessionToken } from '../../../lib/auth/session';
import { json } from '../../../lib/http';
import { adminLoginSchema } from '../../../lib/validation';

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const parsed = adminLoginSchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: 'Identifiants invalides.' }, 400);
		}

		const user = await authenticateAdmin(parsed.data.email, parsed.data.password);
		if (!user) {
			return json({ error: 'Accès refusé.' }, 401);
		}

		const token = await createAdminSessionToken(user.email);
		return json({ ok: true }, 200, {
			'Set-Cookie': adminCookieOptions(token),
		});
	} catch (error) {
		console.error('[admin/login]', error);
		return json({ error: 'Erreur de connexion.' }, 500);
	}
};
