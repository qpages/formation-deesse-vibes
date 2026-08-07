import type { APIRoute } from 'astro';
import { clearAdminCookie } from '../../../lib/auth/session';
import { json } from '../../../lib/http';

export const POST: APIRoute = async () => {
	return json({ ok: true }, 200, {
		'Set-Cookie': clearAdminCookie(),
	});
};
