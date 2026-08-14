import { getEnv } from '../env';
import { getPrisma } from '../prisma';
import {
	getTeachizyCustomerByEmail,
	inviteToTeachizy,
	isTeachizyConfigured,
	type TeachizyCustomer,
} from '../teachizy';
import { findEnrollmentById } from './enrollment';

export type TeachizyPresence =
	| { present: true; enrolledAt: Date | null; blocked: boolean; disabled: boolean }
	| { present: false; reason: 'not_configured' | 'not_found' | 'no_training' };

export type SyncTeachizyResult =
	| {
			ok: true;
			outcome: 'already_active' | 'marked_active' | 'not_on_teachizy';
			message?: string;
	  }
	| {
			ok: false;
			reason:
				| 'enrollment_not_found'
				| 'not_eligible'
				| 'blocked'
				| 'account_disabled'
				| 'not_configured'
				| 'api_error';
			detail?: string;
	  };

export type InviteOrConfirmResult =
	| { invited: true }
	| { confirmed: true; source: 'already_present' };

function parseEnrolledAt(value: string | null | undefined): Date | null {
	if (!value) return null;
	const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Lit Teachizy : apprenant + formation cible présents ? */
export async function inspectTeachizyPresence(email: string): Promise<TeachizyPresence> {
	if (!isTeachizyConfigured()) {
		return { present: false, reason: 'not_configured' };
	}

	const customer = await getTeachizyCustomerByEmail(email);
	if (!customer) {
		return { present: false, reason: 'not_found' };
	}

	return presenceFromCustomer(customer);
}

export function presenceFromCustomer(customer: TeachizyCustomer): TeachizyPresence {
	const trainingUuid = getEnv().TEACHIZY_TRAINING_UUID;
	const training = trainingUuid
		? customer.trainings.find((row) => row.training.uuid === trainingUuid)
		: customer.trainings[0];
	if (!training) {
		return { present: false, reason: 'no_training' };
	}

	return {
		present: true,
		enrolledAt: parseEnrolledAt(training.enrolled_at),
		blocked: Boolean(training.blocked_at),
		disabled: customer.status === 'DISABLED',
	};
}

export async function markEnrollmentTeachizyActive(
	enrollmentId: string,
	opts?: { invitedAt?: Date | null; accessGrantedAt?: Date | null },
): Promise<void> {
	const now = new Date();
	await getPrisma().enrollment.update({
		where: { id: enrollmentId },
		data: {
			accessStatus: 'active',
			accessGrantedAt: opts?.accessGrantedAt ?? now,
			accessSuspendedAt: null,
			teachizyInvitedAt: opts?.invitedAt ?? now,
		},
	});
}

/**
 * Invite Teachizy ; si l’API échoue mais l’apprenant a déjà la formation → succès.
 * Évite le piège « Invitation en cours » alors que Teachizy a déjà l’accès.
 */
export async function inviteOrConfirmTeachizy(input: {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
}): Promise<InviteOrConfirmResult> {
	try {
		await inviteToTeachizy(input);
		return { invited: true };
	} catch (error) {
		const presence = await inspectTeachizyPresence(input.email);
		if (
			presence.present &&
			!presence.blocked &&
			!presence.disabled
		) {
			console.warn('[Teachizy] invite failed but learner already on training — confirming', {
				enrollmentId: input.enrollmentId,
				email: input.email,
				error: error instanceof Error ? error.message : String(error),
			});
			return { confirmed: true, source: 'already_present' };
		}
		throw error;
	}
}

/**
 * Sync admin : lit Teachizy et pose accessStatus=active si la formation est là.
 * Promote-only (pas de suspend/revoke ici).
 */
export async function syncTeachizyAccess(enrollmentId: string): Promise<SyncTeachizyResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}

	if (
		enrollment.accessStatus === 'revoked' ||
		enrollment.collectionStatus === 'refunded' ||
		enrollment.collectionStatus === 'canceled'
	) {
		return { ok: false, reason: 'not_eligible' };
	}

	if (enrollment.contractStatus !== 'signed') {
		return { ok: false, reason: 'not_eligible' };
	}

	if (enrollment.accessStatus === 'active' && enrollment.teachizyInvitedAt) {
		return { ok: true, outcome: 'already_active' };
	}

	if (!isTeachizyConfigured()) {
		return { ok: false, reason: 'not_configured' };
	}

	let presence: TeachizyPresence;
	try {
		presence = await inspectTeachizyPresence(enrollment.user.email);
	} catch (error) {
		return {
			ok: false,
			reason: 'api_error',
			detail: error instanceof Error ? error.message : String(error),
		};
	}

	if (!presence.present) {
		if (presence.reason === 'not_configured') {
			return { ok: false, reason: 'not_configured' };
		}
		return {
			ok: true,
			outcome: 'not_on_teachizy',
			message:
				presence.reason === 'no_training'
					? 'Compte Teachizy trouvé, mais pas inscrit à la formation cible.'
					: 'Pas encore d’apprenant Teachizy pour cet e-mail.',
		};
	}

	if (presence.disabled) {
		return { ok: false, reason: 'account_disabled' };
	}
	if (presence.blocked) {
		return { ok: false, reason: 'blocked' };
	}

	await markEnrollmentTeachizyActive(enrollmentId, {
		invitedAt: enrollment.teachizyInvitedAt ?? presence.enrolledAt ?? new Date(),
		accessGrantedAt: enrollment.accessGrantedAt ?? presence.enrolledAt ?? new Date(),
	});

	return { ok: true, outcome: 'marked_active' };
}
