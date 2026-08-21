import type { APIRoute } from 'astro';
import { json, requireAdminApi } from '../../../lib/admin/auth';
import { dispatchAdminAction } from '../../../lib/admin/dispatch';
import { getPrisma } from '../../../lib/prisma';
import { findEnrollmentById } from '../../../lib/enrollment';
import { adminActionSchema } from '../../../lib/validation';

/**
 * Admin = auth + validate + dispatch (inngest.send / sync lecture).
 * Zéro invite/NDA provider inline.
 */
export const POST: APIRoute = async ({ request }) => {
	const admin = await requireAdminApi(request);
	if (admin instanceof Response) return admin;

	try {
		const parsed = adminActionSchema.safeParse(await request.json());
		if (!parsed.success) {
			return json({ error: 'Action invalide.' }, 400);
		}

		const enrollment = await findEnrollmentById(parsed.data.enrollmentId);
		if (!enrollment) {
			return json({ error: 'Inscription introuvable.' }, 404);
		}

		const result = await dispatchAdminAction(parsed.data.action, enrollment);
		if (!result.ok) {
			return json({ error: result.error }, result.status ?? 400);
		}

		await getPrisma().adminAction.create({
			data: {
				enrollmentId: enrollment.id,
				adminEmail: admin,
				action: parsed.data.action,
			},
		});

		return json({
			ok: true,
			...(result.message ? { message: result.message } : {}),
			...(result.toast ? { toast: result.toast } : {}),
			...(result.copyUrl ? { copyUrl: result.copyUrl } : {}),
		});
	} catch (error) {
		console.error('[admin/action]', error);
		return json({ error: 'Échec de l’action.' }, 500);
	}
};
