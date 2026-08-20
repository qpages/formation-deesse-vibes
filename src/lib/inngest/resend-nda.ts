import { canResendNda, findEnrollmentByIdOrThrow, markNdaResent } from '../enrollment';
import { recordNdaError } from '../signature/persist';
import { alertFinalFailure, formatErrorDetail, withJobLifecycleAlerts } from '../services/slack';
import { resolveExternalRequestId } from '../signature/nda-request';
import { resolveSignatureProviderForEnrollment } from '../signature/providers';
import { inngest } from './client';

/** Command: resend NDA (admin resend_nda / api nda/resend). */
export const resendNda = inngest.createFunction(
	{
		id: 'resend-nda',
		retries: 3,
		triggers: [{ event: 'admin/resend-nda' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			const enrollmentId = original.event?.data?.enrollmentId;
			const detail = formatErrorDetail(error);
			if (enrollmentId) {
				await recordNdaError(enrollmentId, `Renvoi NDA — ${detail}`);
			}
			await alertFinalFailure({
				title: 'Échec définitif renvoi NDA',
				enrollmentId,
				error: detail,
			});
		},
	},
	async ({ event, step, attempt }) => {
		const { enrollmentId } = event.data;

		return withJobLifecycleAlerts({
			attempt,
			jobLabel: 'Renvoi NDA',
			enrollmentId,
			run: async () => {
				const allowed = await step.run('gate-resend', async () => {
					const enrollment = await findEnrollmentByIdOrThrow(enrollmentId);
					return canResendNda(enrollment);
				});
				if (!allowed.ok) {
					return { skipped: true, reason: allowed.reason };
				}

				await step.run('reactivate-and-mark', async () => {
					const enrollment = await findEnrollmentByIdOrThrow(enrollmentId);
					const requestId = resolveExternalRequestId(enrollment);
					if (!requestId) {
						throw new Error('no_nda_request');
					}
					const provider = resolveSignatureProviderForEnrollment(enrollment);
					if (!provider.reactivateNda) {
						throw new Error('reactivateNda indisponible pour ce provider');
					}
					await provider.reactivateNda(requestId);
					await markNdaResent(enrollment);
				});

				return { ok: true };
			},
		});
	},
);
