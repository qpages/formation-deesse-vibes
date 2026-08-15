import { isPaidEnough } from '../enrollment-gates';
import {
	clearNdaFields,
	findEnrollmentByIdOrThrow,
	persistNdaDraftRequestId,
	persistNdaProvisioned,
	recordYousignError,
} from '../services/enrollment';
import {
	alertFinalFailure,
	formatErrorDetail,
	notifyOps,
	withJobLifecycleAlerts,
} from '../services/slack';
import { activateNdaRequest, createNdaDraft, isNdaFullyProvisioned } from '../yousign';
import { inngest } from './client';

/** Command: créer / activer NDA après paiement (aussi admin recreate/retrigger). */
export const createNdaAfterPayment = inngest.createFunction(
	{
		id: 'create-nda-after-payment',
		retries: 2,
		triggers: [{ event: 'stripe/payment.confirmed' }, { event: 'admin/recreate-nda' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			const enrollmentId = original.event?.data?.enrollmentId;
			const detail = formatErrorDetail(error);
			if (enrollmentId) {
				await recordYousignError(enrollmentId, `Création NDA — ${detail}`);
			}
			await alertFinalFailure({
				title: 'Échec définitif création NDA Yousign',
				enrollmentId,
				error: detail,
			});
		},
	},
	async ({ event, step, attempt }) => {
		const { enrollmentId } = event.data;
		const isRecreate = event.name === 'admin/recreate-nda';

		return withJobLifecycleAlerts({
			attempt,
			jobLabel: 'Création NDA Yousign',
			enrollmentId,
			run: async () => {
				const enrollment = await step.run('load-enrollment', async () => {
					return findEnrollmentByIdOrThrow(enrollmentId);
				});

				if (!isRecreate && isNdaFullyProvisioned(enrollment)) {
					return { skipped: true, reason: 'nda_already_created' };
				}

				if (!isPaidEnough(enrollment.collectionStatus)) {
					return { skipped: true, reason: `collection_${enrollment.collectionStatus}` };
				}

				if (isRecreate) {
					await step.run('clear-nda-ids', async () => {
						await clearNdaFields(enrollment.id);
					});
				}

				const requestId =
					(!isRecreate && enrollment.yousignRequestId) ||
					(await step.run('create-yousign-draft', async () => {
						const draft = await createNdaDraft({
							enrollmentId: enrollment.id,
							email: enrollment.user.email,
							firstName: enrollment.user.firstName,
							lastName: enrollment.user.lastName,
						});
						return draft.requestId;
					}));

				if (isRecreate || !enrollment.yousignRequestId) {
					await step.run('persist-yousign-draft-id', async () => {
						await persistNdaDraftRequestId(enrollment.id, requestId);
					});
				}

				const nda = await step.run('activate-yousign-request', async () => {
					return activateNdaRequest(requestId);
				});

				await step.run('persist-nda', async () => {
					await persistNdaProvisioned(enrollment.id, {
						requestId: nda.requestId,
						signerId: nda.signerId,
					});
				});

				await step.run('notify-nda-sent', async () => {
					await notifyOps({
						kind: 'nda.sent',
						severity: 'info',
						title: isRecreate ? 'NDA recréé et envoyé' : 'NDA envoyé',
						enrollmentId: enrollment.id,
						email: enrollment.user.email,
						detail: `requestId=${nda.requestId}`,
					});
				});

				return { requestId: nda.requestId };
			},
		});
	},
);
