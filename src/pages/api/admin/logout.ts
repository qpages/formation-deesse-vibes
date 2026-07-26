import type { APIRoute } from 'astro';
import { clearAdminCookie } from '../../../lib/auth/session';

export const POST: APIRoute = async () => {
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Set-Cookie': clearAdminCookie(),
		},
	});
};
