import { findEnrollmentByIdOrThrow } from '../enrollment';
import { sendPastDueSuspensionEmail } from '../services/brevo';
import {
	alertFinalFailure,
	formatErrorDetail,
	notifyOps,
	withJobLifecycleAlerts,
} from '../services/slack';
import { blockTeachizyCustomer, isTeachizyConfigured } from '../teachizy';
import { inngest } from './client';

/**
 * Command: bloque Teachizy + e-mail impayé.
 * Trigger: enrollment/access.suspend (transition active → suspended, past_due).
 */
export async function handleSuspendTeachizyAccess({
	event,
	step,
	attempt,
}: {
	event: { data: { enrollmentId: string } };
	step: { run<T>(id: string, handler: () => T | Promise<T>): Promise<T> };
	attempt: number;
}) {
	const { enrollmentId } = event.data;

	return withJobLifecycleAlerts({
		attempt,
		jobLabel: 'Suspension Teachizy (impayé)',
		enrollmentId,
		run: async () => {
			const enrollment = await step.run('load-enrollment', async () => {
				return findEnrollmentByIdOrThrow(enrollmentId);
			});

			if (!isTeachizyConfigured()) {
				return { skipped: true, reason: 'not_configured' };
			}

			if (enrollment.accessStatus !== 'suspended') {
				return { skipped: true, reason: 'not_suspended' };
			}

			const blockResult = await step.run('block-teachizy', async () => {
				return blockTeachizyCustomer(enrollment.user.email);
			});

			const emailSent =
				blockResult !== 'not_found' &&
				(await step.run('send-suspension-email', async () => {
					await sendPastDueSuspensionEmail({
						to: enrollment.user.email,
						firstName: enrollment.user.firstName,
					});
					return true;
				}));

			await step.run('notify-suspended', async () => {
				await notifyOps({
					kind: 'access.suspended',
					severity: 'warn',
					title: 'Accès Teachizy suspendu (impayé)',
					enrollmentId: enrollment.id,
					email: enrollment.user.email,
					detail: `Teachizy: ${blockResult}${emailSent ? '' : ' (e-mail impayé non envoyé — pas encore sur Teachizy)'}`,
				});
			});

			return { blocked: true, blockResult, emailSent };
		},
	});
}

export const suspendTeachizyAccess = inngest.createFunction(
	{
		id: 'suspend-teachizy-access',
		retries: 2,
		triggers: [{ event: 'enrollment/access.suspend' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec définitif suspension Teachizy',
				enrollmentId: original.event?.data?.enrollmentId,
				error: formatErrorDetail(error),
			});
		},
	},
	handleSuspendTeachizyAccess,
);
