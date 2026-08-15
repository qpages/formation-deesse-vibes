import type { APIRoute } from 'astro';
import {
	ADMIN_COOKIE,
	parseCookie,
	TRACKING_COOKIE,
	verifyAdminSessionToken,
	verifyEnrollmentSessionToken,
} from '../../../lib/auth/session';
import { inngest } from '../../../lib/inngest/client';
import { json } from '../../../lib/http';
import {
	canResendNda,
	findEnrollmentById,
} from '../../../lib/services/enrollment';
import { notifyOps } from '../../../lib/services/slack';

export const POST: APIRoute = async ({ request }) => {
	try {
		const cookie = request.headers.get('cookie');
		const enrollmentToken = parseCookie(cookie, TRACKING_COOKIE);
		const adminToken = parseCookie(cookie, ADMIN_COOKIE);

		const enrollmentIdFromSession = enrollmentToken
			? await verifyEnrollmentSessionToken(enrollmentToken)
			: null;
		const adminEmail = adminToken ? await verifyAdminSessionToken(adminToken) : null;

		const body = (await request.json().catch(() => ({}))) as { enrollmentId?: string };
		const enrollmentId = body.enrollmentId ?? enrollmentIdFromSession;

		if (!enrollmentId) {
			return json({ error: 'Session requise.' }, 401);
		}

		if (!enrollmentIdFromSession && !adminEmail) {
			return json({ error: 'Non autorisé.' }, 401);
		}

		if (enrollmentIdFromSession && enrollmentIdFromSession !== enrollmentId && !adminEmail) {
			return json({ error: 'Non autorisé.' }, 403);
		}

		const enrollment = await findEnrollmentById(enrollmentId);
		if (!enrollment) {
			return json({ error: 'Inscription introuvable.' }, 404);
		}

		const allowed = await canResendNda(enrollment);
		if (!allowed.ok) {
			return json({ error: allowed.reason }, 429);
		}

		await inngest.send({
			name: 'admin/resend-nda',
			data: { enrollmentId: enrollment.id },
		});

		await notifyOps({
			kind: 'nda.resend_requested',
			severity: 'info',
			title: 'Renvoi NDA demandé',
			enrollmentId: enrollment.id,
			email: enrollment.user.email,
			detail: adminEmail ? `via=admin (${adminEmail})` : 'via=élève',
		});

		return json({ ok: true, message: 'L’accord a été renvoyé par e-mail (Yousign).' });
	} catch (error) {
		console.error('[nda/resend]', error);
		return json({ error: 'Échec du renvoi du NDA.' }, 500);
	}
};
