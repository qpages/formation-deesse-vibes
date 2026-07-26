import type { APIRoute } from 'astro';
import { authenticateAdmin } from '../../../lib/auth/admin';
import { adminCookieOptions, createAdminSessionToken } from '../../../lib/auth/session';
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
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Set-Cookie': adminCookieOptions(token),
			},
		});
	} catch (error) {
		console.error('[admin/login]', error);
		return json({ error: 'Erreur de connexion.' }, 500);
	}
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
