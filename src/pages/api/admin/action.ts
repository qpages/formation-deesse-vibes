import type { APIRoute } from 'astro';
import {
	ADMIN_COOKIE,
	parseCookie,
	verifyAdminSessionToken,
} from '../../../lib/auth/session';
import { getPrisma } from '../../../lib/db';
import {
	canResendNda,
	markNdaResent,
	resolveNdaSignUrl,
} from '../../../lib/services/enrollment';
import { triggerTeachizyInvite } from '../../../lib/services/make';
import { sendNdaReminderEmail } from '../../../lib/services/resend';
import { createNdaFromTemplate, reactivateNda } from '../../../lib/services/yousign';
import { adminActionSchema } from '../../../lib/validation';

export const POST: APIRoute = async ({ request }) => {
	const adminEmail = await verifyAdminSessionToken(
		parseCookie(request.headers.get('cookie'), ADMIN_COOKIE) ?? '',
	);
	if (!adminEmail) {
		return json({ error: 'Non autorisé.' }, 401);
	}

	try {
		const parsed = adminActionSchema.safeParse(await request.json());
		if (!parsed.success) {
			return json({ error: 'Action invalide.' }, 400);
		}

		const prisma = getPrisma();
		const enrollment = await prisma.enrollment.findUnique({
			where: { id: parsed.data.enrollmentId },
		});
		if (!enrollment) {
			return json({ error: 'Inscription introuvable.' }, 404);
		}

		const { action } = parsed.data;

		if (action === 'relance_nda') {
			const allowed = await canResendNda(enrollment);
			if (!allowed.ok) return json({ error: allowed.reason }, 429);
			if (enrollment.yousignRequestId) {
				await reactivateNda(enrollment.yousignRequestId);
			}
			const signUrl = await resolveNdaSignUrl(enrollment);
			if (signUrl) {
				await sendNdaReminderEmail({
					to: enrollment.email,
					firstName: enrollment.firstName,
					signUrl,
				});
			}
			await markNdaResent(enrollment);
		}

		if (action === 'recreate_nda') {
			const nda = await createNdaFromTemplate({
				enrollmentId: enrollment.id,
				email: enrollment.email,
				firstName: enrollment.firstName,
				lastName: enrollment.lastName,
			});
			await prisma.enrollment.update({
				where: { id: enrollment.id },
				data: {
					yousignRequestId: nda.requestId,
					yousignSignerId: nda.signerId,
					status: 'nda_envoye',
				},
			});
			if (nda.signatureLink) {
				await sendNdaReminderEmail({
					to: enrollment.email,
					firstName: enrollment.firstName,
					signUrl: nda.signatureLink,
				});
			}
		}

		if (action === 'mark_rembourse') {
			await prisma.enrollment.update({
				where: { id: enrollment.id },
				data: { status: 'rembourse' },
			});
		}

		if (action === 'mark_acces_retire') {
			await prisma.enrollment.update({
				where: { id: enrollment.id },
				data: { status: 'acces_retire' },
			});
		}

		if (action === 'retrigger_make') {
			if (!enrollment.yousignRequestId) {
				return json({ error: 'Pas de NDA associé.' }, 400);
			}
			await triggerTeachizyInvite({
				enrollmentId: enrollment.id,
				email: enrollment.email,
				firstName: enrollment.firstName,
				lastName: enrollment.lastName,
				yousignRequestId: enrollment.yousignRequestId,
			});
			await prisma.enrollment.update({
				where: { id: enrollment.id },
				data: {
					status: 'invitation_envoyee',
					makeWebhookSentAt: new Date(),
					teachizyInvitedAt: new Date(),
				},
			});
		}

		await prisma.adminAction.create({
			data: {
				enrollmentId: enrollment.id,
				adminEmail,
				action,
			},
		});

		return json({ ok: true });
	} catch (error) {
		console.error('[admin/action]', error);
		return json({ error: 'Échec de l’action.' }, 500);
	}
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
