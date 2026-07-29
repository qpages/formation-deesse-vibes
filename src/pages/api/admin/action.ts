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
} from '../../../lib/services/enrollment';
import {
	inviteToTeachizy,
	triggerInviteAfterSignature,
} from '../../../lib/services/teachizy';
import {
	syncPaymentFromStripe,
	triggerNdaAfterPayment,
} from '../../../lib/services/payment';
import {
	createNdaFromTemplate,
	reactivateNda,
	syncYousignStatus,
} from '../../../lib/services/yousign';
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

		if (action === 'sync_payment') {
			const result = await syncPaymentFromStripe(enrollment.id);
			if (!result.ok) {
				const messages: Record<string, string> = {
					no_checkout_session: 'Aucune session Stripe associée.',
					enrollment_not_found: 'Inscription introuvable.',
				};
				const detail = messages[result.reason] ?? result.reason;
				return json({ error: `Paiement non confirmable : ${detail}` }, 400);
			}
		}

		if (action === 'sync_yousign') {
			const result = await syncYousignStatus(enrollment.id);
			if (!result.ok) {
				const messages: Record<string, string> = {
					enrollment_not_found: 'Inscription introuvable.',
					no_yousign_request: 'Aucune demande Yousign associée.',
					unmapped_status: result.detail
						? `Statut Yousign inconnu : ${result.detail}`
						: 'Statut Yousign inconnu.',
				};
				return json({ error: messages[result.reason] ?? result.reason }, 400);
			}
		}

		if (action === 'retrigger_nda') {
			const result = await triggerNdaAfterPayment(enrollment.id);
			if (!result.ok) {
				const messages: Record<string, string> = {
					enrollment_not_found: 'Inscription introuvable.',
					status_incompatible:
						'Statut incompatible (besoin paiement confirmé ou NDA envoyé).',
					nda_already_created:
						'NDA déjà créé. Utilisez Relancer ou Recréer NDA.',
				};
				return json({ error: messages[result.reason] ?? result.reason }, 400);
			}
		}

		if (action === 'retrigger_signature') {
			const result = await triggerInviteAfterSignature(enrollment.id);
			if (!result.ok) {
				const messages: Record<string, string> = {
					enrollment_not_found: 'Inscription introuvable.',
					no_yousign_request: 'Aucune demande Yousign associée.',
					status_incompatible:
						'Statut incompatible (besoin NDA envoyé ou signé).',
					already_invited: 'Invitation Teachizy déjà envoyée.',
				};
				return json({ error: messages[result.reason] ?? result.reason }, 400);
			}
		}

		if (action === 'relance_nda') {
			const allowed = await canResendNda(enrollment);
			if (!allowed.ok) return json({ error: allowed.reason }, 429);
			await reactivateNda(enrollment.yousignRequestId!);
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
					yousignStatus: 'ongoing',
					status: 'nda_envoye',
				},
			});
		}

		if (action === 'delete_nda') {
			const resetStatus =
				enrollment.status === 'nda_envoye' ||
				enrollment.status === 'nda_signe' ||
				enrollment.status === 'teachizy_envoye';

			await prisma.enrollment.update({
				where: { id: enrollment.id },
				data: {
					yousignRequestId: null,
					yousignSignerId: null,
					yousignStatus: null,
					ndaResendCount: 0,
					ndaResendDay: null,
					ndaLastResendAt: null,
					...(resetStatus ? { status: 'paiement_confirme' as const } : {}),
				},
			});
		}

		if (action === 'retrigger_teachizy') {
			await inviteToTeachizy({
				enrollmentId: enrollment.id,
				email: enrollment.email,
				firstName: enrollment.firstName,
				lastName: enrollment.lastName,
			});
			// Première invite : pose la source of truth. Resend : API only (audit via AdminAction).
			if (!enrollment.teachizyInvitedAt) {
				await prisma.enrollment.update({
					where: { id: enrollment.id },
					data: {
						status: 'teachizy_envoye',
						teachizyInvitedAt: new Date(),
					},
				});
			} else if (enrollment.status !== 'teachizy_envoye') {
				await prisma.enrollment.update({
					where: { id: enrollment.id },
					data: { status: 'teachizy_envoye' },
				});
			}
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
