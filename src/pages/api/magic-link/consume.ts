import type { APIRoute } from 'astro';
import { completeMagicLinkConsume } from '../../../lib/pages/resolve-home-enrollment';

export const POST: APIRoute = async ({ request }) => {
	const form = await request.formData();
	const token = String(form.get('token') ?? '').trim();
	if (!token) {
		return Response.redirect(new URL('/?link=invalid', request.url), 303);
	}

	const result = await completeMagicLinkConsume(token, request.headers.get('cookie'));
	const headers = new Headers({
		Location: new URL(result.redirectTo, request.url).toString(),
	});
	if (result.setCookie) {
		headers.append('Set-Cookie', result.setCookie);
	}
	return new Response(null, { status: 303, headers });
};
