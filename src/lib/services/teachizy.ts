import { requireEnv } from '../env';
import { getPrisma } from '../db';
import { inngest } from '../inngest/client';

interface TeachizyInviteInput {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
}

/**
 * Invite un apprenant directement sur Teachizy via leur API REST.
 * @see https://developer.teachizy.fr/
 */
export async function inviteToTeachizy(input: TeachizyInviteInput): Promise<void> {
	const apiKey = requireEnv('TEACHIZY_API_KEY');
	const baseUrl = requireEnv('TEACHIZY_API_BASE');
	const trainingUuid = requireEnv('TEACHIZY_TRAINING_UUID');

	console.log('[Teachizy] Sending invitation', {
		enrollmentId: input.enrollmentId,
		email: input.email,
		firstName: input.firstName,
		lastName: input.lastName,
		trainingUuid,
	});

	const response = await fetch(`${baseUrl}/externals/automations/customers`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			firstname: input.firstName,
			lastname: input.lastName,
			email: input.email,
			training_uuids: [trainingUuid],
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		console.error('[Teachizy] API error', {
			status: response.status,
			body,
			enrollmentId: input.enrollmentId,
		});
		throw new Error(`Teachizy API error ${response.status}: ${body}`, {
			cause: { enrollmentId: input.enrollmentId },
		});
	}

	console.log('[Teachizy] Invitation sent successfully', {
		enrollmentId: input.enrollmentId,
		status: response.status,
	});
}

/**
 * Déclenche manuellement l'invitation Teachizy via Inngest
 *
 * Envoie l'événement `yousign/signature.done` pour déclencher la fonction
 * Inngest `inviteAfterNdaSigned`.
 *
 * **Utilisé par:** action admin "[dev] trigger Inngest yousign/signature.done"
 *
 * **Guards:**
 * - Enrollment doit exister
 * - yousignRequestId doit être présent
 * - Status doit être `nda_envoye` ou `nda_signe`
 * - Pas déjà invité sur Teachizy
 *
 * @see docs/overview.md#inngest
 */
export async function triggerInviteAfterSignature(enrollmentId: string): Promise<
	| { ok: true }
	| {
			ok: false;
			reason:
				| 'enrollment_not_found'
				| 'no_yousign_request'
				| 'status_incompatible'
				| 'already_invited';
	  }
> {
	const enrollment = await getPrisma().enrollment.findUnique({ where: { id: enrollmentId } });
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	if (!enrollment.yousignRequestId) {
		return { ok: false, reason: 'no_yousign_request' };
	}
	if (enrollment.teachizyInvitedAt || enrollment.status === 'teachizy_envoye') {
		return { ok: false, reason: 'already_invited' };
	}
	if (enrollment.status !== 'nda_envoye' && enrollment.status !== 'nda_signe') {
		return { ok: false, reason: 'status_incompatible' };
	}

	await inngest.send({
		name: 'yousign/signature.done',
		data: {
			enrollmentId,
			yousignEventId: `admin-retrigger-signature:${enrollmentId}:${Date.now()}`,
			requestId: enrollment.yousignRequestId,
		},
	});
	return { ok: true };
}
