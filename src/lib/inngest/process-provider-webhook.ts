import { getPrisma } from '../prisma';
import {
	markProviderEventFailed,
	markProviderEventIgnored,
	markProviderEventProcessed,
} from '../services/provider-events';
import {
	alertFinalFailure,
	formatErrorDetail,
	withJobLifecycleAlerts,
} from '../services/slack';
import { inngest, type AppEvents } from './client';

type ProviderEventName =
	| 'provider/stripe-event.received'
	| 'provider/yousign-event.received';

type HandleResult = { enrollmentId?: string; ignored?: boolean };

/**
 * Parameterize Method: charge → skip si déjà traité → handle → mark.
 * Stripe / Yousign ne diffèrent que par l’event et le handler métier.
 */
export function createProcessProviderWebhook(opts: {
	id: string;
	event: ProviderEventName;
	jobLabel: string;
	handle: (input: {
		providerEventId: string;
		eventType: string;
		payloadCipherText: string | null;
	}) => Promise<HandleResult>;
}) {
	return inngest.createFunction(
		{
			id: opts.id,
			retries: 2,
			triggers: [{ event: opts.event }],
			onFailure: async ({ event, error }) => {
				const original = event.data as {
					event?: { data?: { providerEventId?: string } };
				};
				const providerEventId = original.event?.data?.providerEventId;
				if (providerEventId) {
					await markProviderEventFailed(providerEventId, formatErrorDetail(error));
				}
				await alertFinalFailure({
					title: `Échec définitif ${opts.jobLabel}`,
					error: formatErrorDetail(error),
				});
			},
		},
		async ({ event, step, attempt }) => {
			const { providerEventId } = event.data as AppEvents[ProviderEventName]['data'];

			return withJobLifecycleAlerts({
				attempt,
				jobLabel: opts.jobLabel,
				run: async () => {
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
							return opts.handle({
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
						const message = formatErrorDetail(error);
						await step.run('mark-failed', () => markProviderEventFailed(row.id, message));
						throw error;
					}
				},
			});
		},
	);
}
