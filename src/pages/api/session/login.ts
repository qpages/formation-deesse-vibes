import type { APIRoute } from 'astro';
import {
	createEnrollmentSessionToken,
	enrollmentCookieOptions,
} from '../../../lib/auth/session';
import { json } from '../../../lib/http';
import { findEnrollmentByEmail } from '../../../lib/services/enrollment';
import { magicLinkSchema } from '../../../lib/validation';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const parsed = magicLinkSchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: parsed.error.issues[0]?.message ?? 'E-mail invalide' }, 400);
		}

		const enrollment = await findEnrollmentByEmail(parsed.data.email);
		if (!enrollment || enrollment.collectionStatus === 'pending') {
			return json(
				{ error: 'Aucune inscription active pour cet e-mail.' },
				404,
			);
		}

		const token = await createEnrollmentSessionToken(enrollment.id);
		return json({ ok: true }, 200, {
			'Set-Cookie': enrollmentCookieOptions(token),
		});
	} catch (error) {
		console.error('[session/login]', error);
		return json({ error: 'Impossible de vous connecter pour le moment.' }, 500);
	}
};
