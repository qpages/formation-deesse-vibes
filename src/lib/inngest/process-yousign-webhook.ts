import { getPrisma } from '../prisma';
import {
	markProviderEventFailed,
	markProviderEventIgnored,
	markProviderEventProcessed,
} from '../services/enrollment';
import { handleYousignProviderEvent } from '../services/yousign-events';
import { alertFinalFailure } from '../services/slack';
import { inngest } from './client';

/** Command: traite un ProviderEvent Yousign (idempotent). */
export const processYousignWebhook = inngest.createFunction(
	{
		id: 'process-yousign-webhook',
		retries: 5,
		triggers: [{ event: 'provider/yousign-event.received' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { providerEventId?: string } } };
			const providerEventId = original.event?.data?.providerEventId;
			if (providerEventId) {
				await markProviderEventFailed(providerEventId, error.message);
			}
			await alertFinalFailure({
				title: 'Échec process Yousign webhook',
				error: error.message,
			});
		},
	},
	async ({ event, step }) => {
		const { providerEventId } = event.data;

		const row = await step.run('load-event', async () => {
			return getPrisma().providerEvent.findUniqueOrThrow({
				where: { id: providerEventId },
			});
		});

		if (row.status === 'processed' || row.status === 'ignored') {
			return { skipped: true, reason: row.status };
		}

		try {
			const result = await step.run('handle', async () => {
				return handleYousignProviderEvent({
					providerEventId: row.providerEventId,
					eventType: row.eventType,
					payloadCipherText: row.payloadCipherText,
				});
			});

			if (result.ignored) {
				await step.run('mark-ignored', () => markProviderEventIgnored(row.id));
				return { ignored: true };
			}

			await step.run('mark-processed', () =>
				markProviderEventProcessed(row.id, result.enrollmentId),
			);
			return { ok: true, enrollmentId: result.enrollmentId };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await step.run('mark-failed', () => markProviderEventFailed(row.id, message));
			throw error;
		}
	},
);
