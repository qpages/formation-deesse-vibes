import type { APIRoute } from 'astro';
import {
	ADMIN_COOKIE,
	parseCookie,
	verifyAdminSessionToken,
} from '../../../lib/auth/session';
import { inngest } from '../../../lib/inngest/client';
import { getPrisma } from '../../../lib/prisma';
import { applyAccessPolicy } from '../../../lib/services/access';
import {
	canResendNda,
	clearNdaFields,
	findEnrollmentById,
	markEnrollmentAccessRevoked,
	markEnrollmentRefunded,
} from '../../../lib/services/enrollment';
import { syncPaymentFromStripe } from '../../../lib/services/payments';
import { syncYousignStatus } from '../../../lib/services/yousign-events';
import { adminActionSchema } from '../../../lib/validation';

/**
 * Admin = auth + validate + inngest.send (+ sync lecture Stripe/Yousign).
 * Zéro invite/NDA/Yousign sync side-effect inline (sauf sync lecture via service).
 */
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

		const enrollment = await findEnrollmentById(parsed.data.enrollmentId);
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
			await applyAccessPolicy(enrollment.id);
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
			if (enrollment.collectionStatus === 'pending') {
				return json(
					{ error: 'Statut incompatible (besoin paiement confirmé).' },
					400,
				);
			}
			await inngest.send({
				name: 'stripe/payment.confirmed',
				data: {
					enrollmentId: enrollment.id,
					stripeEventId: `admin-retrigger-nda:${enrollment.id}:${Date.now()}`,
				},
			});
		}

		if (action === 'retrigger_signature' || action === 'retrigger_teachizy') {
			if (!enrollment.yousignRequestId && action === 'retrigger_signature') {
				return json({ error: 'Aucune demande Yousign associée.' }, 400);
			}
			if (enrollment.accessStatus === 'revoked') {
				return json({ error: 'Accès révoqué — impossible de rejouer Teachizy.' }, 400);
			}
			await inngest.send({
				name: 'enrollment/access.grant',
				data: { enrollmentId: enrollment.id },
			});
		}

		if (action === 'relance_nda') {
			const allowed = await canResendNda(enrollment);
			if (!allowed.ok) return json({ error: allowed.reason }, 429);
			await inngest.send({
				name: 'admin/relance-nda',
				data: { enrollmentId: enrollment.id },
			});
		}

		if (action === 'recreate_nda') {
			await inngest.send({
				name: 'admin/recreate-nda',
				data: { enrollmentId: enrollment.id },
			});
		}

		if (action === 'delete_nda') {
			await clearNdaFields(enrollment.id);
		}

		if (action === 'mark_refunded') {
			if (enrollment.collectionStatus === 'refunded') {
				return json({ error: 'Déjà marqué remboursé.' }, 400);
			}
			await markEnrollmentRefunded(enrollment.id);
			await applyAccessPolicy(enrollment.id);
		}

		if (action === 'revoke_access') {
			if (enrollment.accessStatus === 'revoked') {
				return json({ error: 'Accès déjà retiré.' }, 400);
			}
			if (enrollment.collectionStatus === 'refunded') {
				return json({ error: 'Inscription déjà remboursée.' }, 400);
			}
			await markEnrollmentAccessRevoked(enrollment.id);
			await applyAccessPolicy(enrollment.id);
		}

		await getPrisma().adminAction.create({
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
