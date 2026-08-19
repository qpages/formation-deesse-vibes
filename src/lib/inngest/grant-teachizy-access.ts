import { applyAccessPolicy } from '../services/access';
import { findEnrollmentByIdOrThrow, updateEnrollmentYousignMirror } from '../services/enrollment';
import { inviteOrConfirmTeachizy, markEnrollmentTeachizyActive } from '../services/teachizy-access';
import {
	alertFinalFailure,
	formatErrorDetail,
	notifyOps,
	withJobLifecycleAlerts,
} from '../services/slack';
import { inngest } from './client';

/**
 * Command: invite Teachizy + pose accessStatus=active.
 * Triggers: signature.done, access.grant (admin / policy).
 * Si l’invite échoue mais l’apprenant a déjà la formation → mark active quand même.
 */
export const grantTeachizyAccess = inngest.createFunction(
	{
		id: 'grant-teachizy-access',
		retries: 2,
		triggers: [
			{ event: 'yousign/signature.done' },
			{ event: 'nda/signature.completed' },
			{ event: 'enrollment/access.grant' },
		],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec définitif invitation Teachizy',
				enrollmentId: original.event?.data?.enrollmentId,
				error: formatErrorDetail(error),
			});
		},
	},
	async ({ event, step, attempt }) => {
		const { enrollmentId } = event.data;

		return withJobLifecycleAlerts({
			attempt,
			jobLabel: 'Invitation Teachizy',
			enrollmentId,
			run: async () => {
				const enrollment = await step.run('load-enrollment', async () => {
					return findEnrollmentByIdOrThrow(enrollmentId);
				});

				if (enrollment.teachizyInvitedAt && enrollment.accessStatus === 'active') {
					return { skipped: true, reason: 'already_invited' };
				}

				const isSignatureCompleted =
					event.name === 'yousign/signature.done' || event.name === 'nda/signature.completed';

				if (isSignatureCompleted) {
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

				const inviteResult = await step.run('invite-teachizy', async () => {
					return inviteOrConfirmTeachizy({
						enrollmentId: fresh.id,
						email: fresh.user.email,
						firstName: fresh.user.firstName,
						lastName: fresh.user.lastName,
					});
				});

				await step.run('mark-active', async () => {
					// step.run sérialise les Date → string : re-hydrater avant Prisma.
					await markEnrollmentTeachizyActive(fresh.id, {
						accessGrantedAt: fresh.accessGrantedAt ? new Date(fresh.accessGrantedAt) : null,
						invitedAt: fresh.teachizyInvitedAt ? new Date(fresh.teachizyInvitedAt) : null,
					});
				});

				await step.run('notify-access-active', async () => {
					const via = 'confirmed' in inviteResult ? ' (déjà présent Teachizy)' : '';
					await notifyOps({
						kind: 'access.active',
						severity: 'info',
						title: 'Accès Teachizy actif',
						enrollmentId: fresh.id,
						email: fresh.user.email,
						detail: `${fresh.user.firstName} ${fresh.user.lastName}${via}`,
					});
				});

				return { invited: true, ...inviteResult };
			},
		});
	},
);
