import type { Enrollment } from '../../generated/prisma/client';
import { inngest } from '../inngest/client';
import { canResendNda, findEnrollmentById } from '../services/enrollment';
import { syncPaymentFromStripe } from '../services/payments';
import { notifyOps, type OpsSeverity } from '../services/slack';
import { syncYousignStatus } from '../services/yousign-events';
import { ADMIN_ACTIONS, type AdminActionKey } from './actions';

export type AdminDispatchResult =
	| { ok: true; message?: string; toast?: 'success' | 'info' }
	| { ok: false; error: string; status?: number };

type Handler = (enrollment: Enrollment) => Promise<AdminDispatchResult>;

const ADMIN_NOTIFY_SEVERITY: Record<AdminActionKey, OpsSeverity> = {
	resend_nda: 'info',
	retrigger_teachizy: 'info',
	sync_payment: 'info',
	sync_yousign: 'info',
	recreate_nda: 'warn',
};

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
		// confirmPaidCheckout / sync → ensureNdaAfterPayment (même post-condition que le webhook).
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

	async retrigger_teachizy(enrollment) {
		if (enrollment.accessStatus === 'revoked') {
			return {
				ok: false,
				error: 'Accès révoqué — impossible d’inviter à la formation.',
				status: 400,
			};
		}
		if (enrollment.teachizyInvitedAt && enrollment.accessStatus === 'active') {
			return {
				ok: true,
				message: 'Déjà invitée à la formation — aucun nouvel e-mail envoyé.',
				toast: 'info',
			};
		}
		await inngest.send({
			name: 'enrollment/access.grant',
			data: { enrollmentId: enrollment.id },
		});
		return { ok: true, message: 'Invitation à la formation déclenchée.' };
	},

	async resend_nda(enrollment) {
		const allowed = await canResendNda(enrollment);
		if (!allowed.ok) {
			return { ok: false, error: allowed.reason, status: 429 };
		}
		await inngest.send({
			name: 'admin/resend-nda',
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
} satisfies Record<AdminActionKey, Handler>;

async function notifyAdminAction(
	action: AdminActionKey,
	enrollment: Enrollment,
	result: Extract<AdminDispatchResult, { ok: true }>,
) {
	const def = ADMIN_ACTIONS.find((a) => a.action === action);
	const withUser = await findEnrollmentById(enrollment.id);
	await notifyOps({
		kind: 'admin.action',
		severity: ADMIN_NOTIFY_SEVERITY[action],
		title: `Admin: ${def?.title ?? action}`,
		enrollmentId: enrollment.id,
		email: withUser?.user.email,
		detail: [
			`action=${action}`,
			result.message ? `note=${result.message}` : null,
		]
			.filter(Boolean)
			.join(' | '),
	});
}

export async function dispatchAdminAction(
	action: AdminActionKey,
	enrollment: Enrollment,
): Promise<AdminDispatchResult> {
	const result = await handlers[action](enrollment);
	if (result.ok) {
		await notifyAdminAction(action, enrollment, result);
	}
	return result;
}
