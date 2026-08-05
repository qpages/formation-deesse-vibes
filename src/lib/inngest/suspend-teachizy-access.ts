import { findEnrollmentByIdOrThrow } from '../services/enrollment';
import { alertFinalFailure } from '../services/slack';
import { inngest } from './client';

/**
 * Command: side-effect suspension / revoke Teachizy.
 * MVP: timestamps déjà posés par applyAccessPolicy ; log + audit.
 * Hook API Teachizy suspend = plus tard.
 */
export const suspendTeachizyAccess = inngest.createFunction(
	{
		id: 'suspend-teachizy-access',
		retries: 3,
		triggers: [{ event: 'enrollment/access.suspend' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec suspension accès Teachizy',
				enrollmentId: original.event?.data?.enrollmentId,
				error: error.message,
			});
		},
	},
	async ({ event, step }) => {
		const { enrollmentId, revoke } = event.data;

		const enrollment = await step.run('load-enrollment', async () => {
			return findEnrollmentByIdOrThrow(enrollmentId);
		});

		console.log('[Teachizy] access suspend/revoke recorded', {
			enrollmentId,
			accessStatus: enrollment.accessStatus,
			revoke: Boolean(revoke),
		});

		return {
			ok: true,
			accessStatus: enrollment.accessStatus,
			revoke: Boolean(revoke),
		};
	},
);
