import type { APIRoute } from 'astro';
import { requestMagicLink } from '../../../lib/services/enrollment';
import { magicLinkSchema } from '../../../lib/validation';

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const parsed = magicLinkSchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: parsed.error.issues[0]?.message ?? 'E-mail invalide' }, 400);
		}

		await requestMagicLink(parsed.data.email);
		return json({
			ok: true,
			message:
				'Si une inscription correspond à cet e-mail, vous recevrez un lien dans quelques instants.',
		});
	} catch (error) {
		console.error('[magic-link]', error);
		return json({ error: 'Impossible d’envoyer le lien pour le moment.' }, 500);
	}
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
