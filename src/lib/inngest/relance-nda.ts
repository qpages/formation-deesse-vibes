import { canResendNda, findEnrollmentByIdOrThrow, markNdaResent } from '../services/enrollment';
import { alertFinalFailure } from '../services/slack';
import { reactivateNda } from '../yousign';
import { inngest } from './client';

/** Command: relance Yousign (admin relance_nda / api nda/resend). */
export const relanceNda = inngest.createFunction(
	{
		id: 'relance-nda',
		retries: 3,
		triggers: [{ event: 'admin/relance-nda' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec relance NDA',
				enrollmentId: original.event?.data?.enrollmentId,
				error: error.message,
			});
		},
	},
	async ({ event, step }) => {
		const { enrollmentId } = event.data;

		const allowed = await step.run('gate-resend', async () => {
			const enrollment = await findEnrollmentByIdOrThrow(enrollmentId);
			return canResendNda(enrollment);
		});
		if (!allowed.ok) {
			return { skipped: true, reason: allowed.reason };
		}

		await step.run('reactivate-and-mark', async () => {
			const enrollment = await findEnrollmentByIdOrThrow(enrollmentId);
			if (!enrollment.yousignRequestId) {
				throw new Error('no_yousign_request');
			}
			await reactivateNda(enrollment.yousignRequestId);
			await markNdaResent(enrollment);
		});

		return { ok: true };
	},
);
