import { getPrisma } from '../db';
import { alertFinalFailure } from '../services/slack';
import { triggerTeachizyInvite } from '../services/make';
import {
	purgeOldWebhookPayloads,
	transitionStatus,
} from '../services/enrollment';
import { sendNdaReminderEmail } from '../services/resend';
import { createNdaFromTemplate } from '../services/yousign';
import { inngest } from './client';

export const createNdaAfterPayment = inngest.createFunction(
	{
		id: 'create-nda-after-payment',
		retries: 5,
		triggers: [{ event: 'stripe/payment.confirmed' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec définitif création NDA Yousign',
				enrollmentId: original.event?.data?.enrollmentId,
				error: error.message,
			});
		},
	},
	async ({ event, step }) => {
		const { enrollmentId } = event.data;

		const enrollment = await step.run('load-enrollment', async () => {
			return getPrisma().enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
		});

		if (enrollment.yousignRequestId) {
			return { skipped: true, reason: 'nda_already_created' };
		}

		if (
			enrollment.status !== 'paiement_confirme' &&
			enrollment.status !== 'nda_envoye'
		) {
			return { skipped: true, reason: `status_${enrollment.status}` };
		}

		const nda = await step.run('create-yousign-request', async () => {
			return createNdaFromTemplate({
				enrollmentId: enrollment.id,
				email: enrollment.email,
				firstName: enrollment.firstName,
				lastName: enrollment.lastName,
			});
		});

		await step.run('persist-nda', async () => {
			await getPrisma().enrollment.update({
				where: { id: enrollment.id },
				data: {
					yousignRequestId: nda.requestId,
					yousignSignerId: nda.signerId,
					status: 'nda_envoye',
				},
			});
		});

		if (nda.signatureLink) {
			await step.run('email-nda-link', async () => {
				await sendNdaReminderEmail({
					to: enrollment.email,
					firstName: enrollment.firstName,
					signUrl: nda.signatureLink!,
				});
			});
		}

		return { requestId: nda.requestId };
	},
);

export const inviteAfterNdaSigned = inngest.createFunction(
	{
		id: 'invite-after-nda-signed',
		retries: 5,
		triggers: [{ event: 'yousign/signature.done' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec définitif invitation Teachizy (Make)',
				enrollmentId: original.event?.data?.enrollmentId,
				error: error.message,
			});
		},
	},
	async ({ event, step }) => {
		const { enrollmentId, requestId } = event.data;

		const enrollment = await step.run('load-enrollment', async () => {
			return getPrisma().enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
		});

		if (enrollment.makeWebhookSentAt || enrollment.status === 'invitation_envoyee') {
			return { skipped: true, reason: 'already_invited' };
		}

		await step.run('mark-nda-signed', async () => {
			await transitionStatus(enrollment.id, ['nda_envoye', 'paiement_confirme'], 'nda_signe');
		});

		await step.run('trigger-make', async () => {
			await triggerTeachizyInvite({
				enrollmentId: enrollment.id,
				email: enrollment.email,
				firstName: enrollment.firstName,
				lastName: enrollment.lastName,
				yousignRequestId: requestId,
			});
		});

		await step.run('mark-invited', async () => {
			await getPrisma().enrollment.update({
				where: { id: enrollment.id },
				data: {
					status: 'invitation_envoyee',
					makeWebhookSentAt: new Date(),
					teachizyInvitedAt: new Date(),
				},
			});
		});

		return { invited: true };
	},
);

export const purgeWebhookPayloads = inngest.createFunction(
	{
		id: 'purge-webhook-payloads',
		triggers: [{ cron: '0 3 * * *' }],
	},
	async ({ step }) => {
		await step.run('purge', () => purgeOldWebhookPayloads());
		return { ok: true };
	},
);

export const inngestFunctions = [
	createNdaAfterPayment,
	inviteAfterNdaSigned,
	purgeWebhookPayloads,
];
