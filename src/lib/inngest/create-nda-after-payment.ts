import {
	clearNdaFields,
	findEnrollmentByIdOrThrow,
	persistNdaDraftRequestId,
	persistNdaProvisioned,
} from '../services/enrollment';
import { alertFinalFailure } from '../services/slack';
import {
	activateNdaRequest,
	createNdaDraft,
	isNdaFullyProvisioned,
} from '../yousign';
import { inngest } from './client';

/** Command: créer / activer NDA après paiement (aussi admin recreate/retrigger). */
export const createNdaAfterPayment = inngest.createFunction(
	{
		id: 'create-nda-after-payment',
		retries: 5,
		triggers: [
			{ event: 'stripe/payment.confirmed' },
			{ event: 'admin/recreate-nda' },
		],
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
		const isRecreate = event.name === 'admin/recreate-nda';

		const enrollment = await step.run('load-enrollment', async () => {
			return findEnrollmentByIdOrThrow(enrollmentId);
		});

		if (!isRecreate && isNdaFullyProvisioned(enrollment)) {
			return { skipped: true, reason: 'nda_already_created' };
		}

		const paidEnough =
			enrollment.collectionStatus !== 'pending' &&
			enrollment.collectionStatus !== 'canceled';
		if (!paidEnough) {
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

		return { requestId: nda.requestId };
	},
);
