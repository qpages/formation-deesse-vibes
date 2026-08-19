import type { Enrollment } from '../../generated/prisma/client';
import { sendInngestSafe } from '../inngest/client';
import { canResendNda, findEnrollmentById } from '../services/enrollment';
import { syncPaymentFromStripe } from '../services/payments';
import { notifyOps, type OpsSeverity } from '../services/slack';
import { syncTeachizyAccess } from '../services/teachizy-access';
import { syncNdaStatus } from '../signature/sync-nda';
import { getSignaturePort } from '../signature/factory';
import {
	resolveExternalRequestId,
	resolveExternalSignerId,
	resolveNdaProvider,
} from '../signature/nda-request';
import type { SignSurface } from '../signature/types';
import { ADMIN_ACTIONS, adminActionExecution, type AdminActionKey } from './actions';

export type AdminDispatchResult =
	| { ok: true; message?: string; toast?: 'success' | 'info'; copyUrl?: string }
	| { ok: false; error: string; status?: number };

type Handler = (enrollment: Enrollment) => Promise<AdminDispatchResult>;

/** Message unique quand la file Inngest est indisponible (dev sans `inngest:dev`). */
const QUEUE_DOWN = 'File de traitement indisponible — réessayez plus tard.';

const ADMIN_NOTIFY_SEVERITY: Partial<Record<AdminActionKey, OpsSeverity>> = {
	resend_nda: 'info',
	retrigger_teachizy: 'info',
	sync_teachizy: 'info',
	sync_payment: 'info',
	sync_nda: 'info',
	sync_yousign: 'info',
	recreate_nda: 'warn',
};

async function runSyncNda(enrollment: Enrollment): Promise<AdminDispatchResult> {
	const result = await syncNdaStatus(enrollment.id);
	if (!result.ok) {
		const messages: Record<string, string> = {
			enrollment_not_found: 'Inscription introuvable.',
			no_nda_request: 'Aucune demande de signature NDA associée.',
			draft_not_activated:
				'Demande en brouillon (draft), jamais activée — aucun e-mail envoyé. Recréez le lien de signature.',
			unmapped_status: result.detail
				? `Statut provider inconnu : ${result.detail}`
				: 'Statut provider inconnu.',
		};
		return {
			ok: false,
			error: messages[result.reason] ?? result.reason,
			status: 400,
		};
	}
	if (result.followUp.status === 'failed') {
		return {
			ok: true,
			toast: 'info',
			message:
				'Statut NDA synchronisé. Invitation Teachizy non déclenchée (file indisponible) — relancez « Inviter à la formation ».',
		};
	}
	return { ok: true };
}

const handlers = {
	// --- Actions « sync » : l'effet primaire est le miroir DB. -------------------
	// L'enqueue de l'étape suivante est best-effort : une file HS => succès dégradé.

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
		if (result.ndaEnqueue?.status === 'failed') {
			return {
				ok: true,
				toast: 'info',
				message:
					'Paiement synchronisé. Création du NDA non déclenchée (file indisponible) — relancez « Sync paiement » plus tard.',
			};
		}
		return { ok: true };
	},

	async sync_nda(enrollment) {
		return runSyncNda(enrollment);
	},

	async sync_yousign(enrollment) {
		return runSyncNda(enrollment);
	},

	async sync_teachizy(enrollment) {
		const result = await syncTeachizyAccess(enrollment.id);
		if (!result.ok) {
			const messages: Record<string, string> = {
				enrollment_not_found: 'Inscription introuvable.',
				not_eligible: 'Pas éligible — NDA signé requis, et accès non révoqué / non remboursé.',
				blocked: 'Formation bloquée côté Teachizy — débloquez d’abord sur Teachizy.',
				account_disabled: 'Compte Teachizy désactivé.',
				not_configured: 'Teachizy n’est pas configuré (TEACHIZY_API_KEY).',
				api_error: result.detail ? `Erreur Teachizy : ${result.detail}` : 'Erreur API Teachizy.',
			};
			return {
				ok: false,
				error: messages[result.reason] ?? result.reason,
				status: 400,
			};
		}
		if (result.outcome === 'already_active') {
			return {
				ok: true,
				toast: 'info',
				message: 'Déjà actif côté Teachizy — rien à aligner.',
			};
		}
		if (result.outcome === 'not_on_teachizy') {
			return {
				ok: true,
				toast: 'info',
				message: result.message ?? 'Pas encore sur Teachizy — utilisez « Inviter ».',
			};
		}
		return { ok: true, message: 'Accès Teachizy aligné (actif).' };
	},

	// --- Actions « flow » : l'enqueue Inngest EST l'action. File HS => échec. -----

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
		const send = await sendInngestSafe({
			name: 'enrollment/access.grant',
			data: { enrollmentId: enrollment.id },
		});
		if (send.status === 'failed') {
			return { ok: false, error: QUEUE_DOWN, status: 503 };
		}
		return { ok: true, message: 'Invitation à la formation déclenchée.' };
	},

	async resend_nda(enrollment) {
		const allowed = await canResendNda(enrollment);
		if (!allowed.ok) {
			return { ok: false, error: allowed.reason, status: 429 };
		}
		const send = await sendInngestSafe({
			name: 'admin/resend-nda',
			data: { enrollmentId: enrollment.id },
		});
		if (send.status === 'failed') {
			return { ok: false, error: QUEUE_DOWN, status: 503 };
		}
		return { ok: true };
	},

	async recreate_nda(enrollment) {
		const send = await sendInngestSafe({
			name: 'admin/recreate-nda',
			data: { enrollmentId: enrollment.id },
		});
		if (send.status === 'failed') {
			return { ok: false, error: QUEUE_DOWN, status: 503 };
		}
		return { ok: true };
	},

	// --- Actions « read » : lecture pure, aucun effet persistant. -----------------

	async copy_nda_link(enrollment) {
		if (resolveNdaProvider(enrollment) === 'docuseal') {
			return {
				ok: false,
				error: 'Signature intégrée (embed) — pas de lien à copier.',
				status: 400,
			};
		}

		const requestId = resolveExternalRequestId(enrollment);
		const signerId = resolveExternalSignerId(enrollment);
		if (!requestId || !signerId) {
			return {
				ok: false,
				error: 'Demande ou signataire Yousign manquant.',
				status: 400,
			};
		}
		const surface: SignSurface | null = await getSignaturePort().getSignSurface({
			requestId,
			signerId,
		});
		if (!surface || surface.kind !== 'redirect') {
			return {
				ok: false,
				error: 'Lien de signature indisponible (signataire pas encore notifié ?).',
				status: 400,
			};
		}
		return {
			ok: true,
			message: 'Lien copié dans le presse-papiers.',
			copyUrl: surface.url,
		};
	},
} satisfies Record<AdminActionKey, Handler>;

async function notifyAdminAction(
	action: AdminActionKey,
	enrollment: Enrollment,
	result: Extract<AdminDispatchResult, { ok: true }>,
) {
	const severity = ADMIN_NOTIFY_SEVERITY[action];
	if (!severity) return;

	const def = ADMIN_ACTIONS.find((a) => a.action === action);
	const withUser = await findEnrollmentById(enrollment.id);
	await notifyOps({
		kind: 'admin.action',
		severity,
		title: `Admin: ${def?.title ?? action}`,
		enrollmentId: enrollment.id,
		email: withUser?.user.email,
		detail: [
			`action=${action}`,
			`kind=${adminActionExecution(action)}`,
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
