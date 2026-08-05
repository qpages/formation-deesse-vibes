import { applyAccessPolicy } from '../services/access';
import {
	findEnrollmentByIdOrThrow,
	updateEnrollmentYousignMirror,
} from '../services/enrollment';
import { alertFinalFailure } from '../services/slack';
import { inviteToTeachizy } from '../teachizy';
import { getPrisma } from '../prisma';
import { inngest } from './client';

/**
 * Command: invite Teachizy + pose accessStatus=active.
 * Triggers: signature.done, access.grant (admin / policy).
 */
export const grantTeachizyAccess = inngest.createFunction(
	{
		id: 'grant-teachizy-access',
		retries: 5,
		triggers: [
			{ event: 'yousign/signature.done' },
			{ event: 'enrollment/access.grant' },
		],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec définitif invitation Teachizy',
				enrollmentId: original.event?.data?.enrollmentId,
				error: error.message,
			});
		},
	},
	async ({ event, step }) => {
		const { enrollmentId } = event.data;

		const enrollment = await step.run('load-enrollment', async () => {
			return findEnrollmentByIdOrThrow(enrollmentId);
		});

		if (enrollment.teachizyInvitedAt && enrollment.accessStatus === 'active') {
			return { skipped: true, reason: 'already_invited' };
		}

		if (event.name === 'yousign/signature.done') {
			await step.run('mark-contract-signed', async () => {
				await updateEnrollmentYousignMirror(enrollment.id, {
					yousignStatus: 'done',
					contractStatus: 'signed',
				});
				await applyAccessPolicy(enrollment.id);
			});
		}

		const fresh = await step.run('reload', async () => {
			return findEnrollmentByIdOrThrow(enrollmentId);
		});

		if (fresh.accessStatus === 'revoked' || fresh.collectionStatus === 'refunded') {
			return { skipped: true, reason: 'access_revoked' };
		}

		if (fresh.contractStatus !== 'signed') {
			return { skipped: true, reason: 'contract_not_signed' };
		}

		await step.run('invite-teachizy', async () => {
			await inviteToTeachizy({
				enrollmentId: fresh.id,
				email: fresh.user.email,
				firstName: fresh.user.firstName,
				lastName: fresh.user.lastName,
			});
		});

		await step.run('mark-active', async () => {
			await getPrisma().enrollment.update({
				where: { id: fresh.id },
				data: {
					accessStatus: 'active',
					accessGrantedAt: fresh.accessGrantedAt ?? new Date(),
					accessSuspendedAt: null,
					teachizyInvitedAt: fresh.teachizyInvitedAt ?? new Date(),
				},
			});
		});

		return { invited: true };
	},
);
