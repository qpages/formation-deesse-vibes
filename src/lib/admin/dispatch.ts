import type { Enrollment } from '../../generated/prisma/client';
import { inngest } from '../inngest/client';
import { applyAccessPolicy } from '../services/access';
import {
	canResendNda,
	clearNdaFields,
	markEnrollmentAccessRevoked,
	markEnrollmentRefunded,
} from '../services/enrollment';
import { syncPaymentFromStripe } from '../services/payments';
import { syncYousignStatus } from '../services/yousign-events';
import type { AdminActionKey } from './actions';

export type AdminDispatchResult =
	| { ok: true }
	| { ok: false; error: string; status?: number };

type Handler = (enrollment: Enrollment) => Promise<AdminDispatchResult>;

const handlers = {
	async sync_payment(enrollment) {
		const result = await syncPaymentFromStripe(enrollment.id);
		if (!result.ok) {
			const messages: Record<string, string> = {
				no_checkout_session: 'Aucune session Stripe associée.',
				enrollment_not_found: 'Inscription introuvable.',
			};
			return {
				ok: false,
				error: `Paiement non confirmable : ${messages[result.reason] ?? result.reason}`,
				status: 400,
			};
		}
		await applyAccessPolicy(enrollment.id);
		return { ok: true };
	},

	async sync_yousign(enrollment) {
		const result = await syncYousignStatus(enrollment.id);
		if (!result.ok) {
			const messages: Record<string, string> = {
				enrollment_not_found: 'Inscription introuvable.',
				no_yousign_request: 'Aucune demande Yousign associée.',
				unmapped_status: result.detail
					? `Statut Yousign inconnu : ${result.detail}`
					: 'Statut Yousign inconnu.',
			};
			return {
				ok: false,
				error: messages[result.reason] ?? result.reason,
				status: 400,
			};
		}
		return { ok: true };
	},

	async retrigger_nda(enrollment) {
		if (enrollment.collectionStatus === 'pending') {
			return {
				ok: false,
				error: 'Statut incompatible (besoin paiement confirmé).',
				status: 400,
			};
		}
		await inngest.send({
			name: 'stripe/payment.confirmed',
			data: {
				enrollmentId: enrollment.id,
				stripeEventId: `admin-retrigger-nda:${enrollment.id}:${Date.now()}`,
			},
		});
		return { ok: true };
	},

	async retrigger_signature(enrollment) {
		if (!enrollment.yousignRequestId) {
			return { ok: false, error: 'Aucune demande Yousign associée.', status: 400 };
		}
		if (enrollment.accessStatus === 'revoked') {
			return {
				ok: false,
				error: 'Accès révoqué — impossible de rejouer Teachizy.',
				status: 400,
			};
		}
		await inngest.send({
			name: 'enrollment/access.grant',
			data: { enrollmentId: enrollment.id },
		});
		return { ok: true };
	},

	async retrigger_teachizy(enrollment) {
		if (enrollment.accessStatus === 'revoked') {
			return {
				ok: false,
				error: 'Accès révoqué — impossible de rejouer Teachizy.',
				status: 400,
			};
		}
		await inngest.send({
			name: 'enrollment/access.grant',
			data: { enrollmentId: enrollment.id },
		});
		return { ok: true };
	},

	async relance_nda(enrollment) {
		const allowed = await canResendNda(enrollment);
		if (!allowed.ok) {
			return { ok: false, error: allowed.reason, status: 429 };
		}
		await inngest.send({
			name: 'admin/relance-nda',
			data: { enrollmentId: enrollment.id },
		});
		return { ok: true };
	},

	async recreate_nda(enrollment) {
		await inngest.send({
			name: 'admin/recreate-nda',
			data: { enrollmentId: enrollment.id },
		});
		return { ok: true };
	},

	async delete_nda(enrollment) {
		await clearNdaFields(enrollment.id);
		return { ok: true };
	},

	async mark_refunded(enrollment) {
		if (enrollment.collectionStatus === 'refunded') {
			return { ok: false, error: 'Déjà marqué remboursé.', status: 400 };
		}
		await markEnrollmentRefunded(enrollment.id);
		await applyAccessPolicy(enrollment.id);
		return { ok: true };
	},

	async revoke_access(enrollment) {
		if (enrollment.accessStatus === 'revoked') {
			return { ok: false, error: 'Accès déjà retiré.', status: 400 };
		}
		if (enrollment.collectionStatus === 'refunded') {
			return { ok: false, error: 'Inscription déjà remboursée.', status: 400 };
		}
		await markEnrollmentAccessRevoked(enrollment.id);
		await applyAccessPolicy(enrollment.id);
		return { ok: true };
	},
} satisfies Record<AdminActionKey, Handler>;

export async function dispatchAdminAction(
	action: AdminActionKey,
	enrollment: Enrollment,
): Promise<AdminDispatchResult> {
	return handlers[action](enrollment);
}
