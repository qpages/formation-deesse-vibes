import { findEnrollmentByIdOrThrow } from '../enrollment';
import {
	alertFinalFailure,
	formatErrorDetail,
	notifyOps,
	withJobLifecycleAlerts,
} from '../services/slack';
import { blockTeachizyCustomer, isTeachizyConfigured } from '../teachizy';
import { inngest } from './client';

/**
 * Command: bloque Teachizy définitivement (remboursement / litige / annulation).
 * Trigger: enrollment/access.revoke — pas de déblocage ultérieur.
 */
export const revokeTeachizyAccess = inngest.createFunction(
	{
		id: 'revoke-teachizy-access',
		retries: 2,
		triggers: [{ event: 'enrollment/access.revoke' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec définitif révocation Teachizy',
				enrollmentId: original.event?.data?.enrollmentId,
				error: formatErrorDetail(error),
			});
		},
	},
	async ({ event, step, attempt }) => {
		const { enrollmentId } = event.data;

		return withJobLifecycleAlerts({
			attempt,
			jobLabel: 'Révocation Teachizy',
			enrollmentId,
			run: async () => {
				const enrollment = await step.run('load-enrollment', async () => {
					return findEnrollmentByIdOrThrow(enrollmentId);
				});

				if (!isTeachizyConfigured()) {
					return { skipped: true, reason: 'not_configured' };
				}

				if (enrollment.accessStatus !== 'revoked') {
					return { skipped: true, reason: 'not_revoked' };
				}

				const blockResult = await step.run('block-teachizy', async () => {
					return blockTeachizyCustomer(enrollment.user.email);
				});

				await step.run('notify-revoked', async () => {
					await notifyOps({
						kind: 'access.revoked',
						severity: 'critical',
						title: 'Accès Teachizy révoqué',
						enrollmentId: enrollment.id,
						email: enrollment.user.email,
						detail: `Teachizy: ${blockResult}`,
					});
				});

				return { blocked: true, blockResult };
			},
		});
	},
);
