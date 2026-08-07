import type { AstroGlobal } from 'astro';
import {
	ADMIN_COOKIE,
	parseCookie,
	verifyAdminSessionToken,
} from '../auth/session';
import { json } from '../http';

export { json };

/** API routes: returns admin email or a 401 Response. */
export async function requireAdminApi(
	request: Request,
): Promise<string | Response> {
	const email = await verifyAdminSessionToken(
		parseCookie(request.headers.get('cookie'), ADMIN_COOKIE) ?? '',
	);
	if (!email) return json({ error: 'Non autorisé.' }, 401);
	return email;
}

/** Astro pages: returns admin email or redirects to login. */
export async function requireAdminPage(
	astro: Pick<AstroGlobal, 'request' | 'redirect'>,
): Promise<string | Response> {
	const email = await verifyAdminSessionToken(
		parseCookie(astro.request.headers.get('cookie'), ADMIN_COOKIE) ?? '',
	);
	if (!email) return astro.redirect('/admin/login');
	return email;
}
