import { isPaidEnough } from '../enrollment-gates';
import { findEnrollmentByIdOrThrow } from '../enrollment';
import {
	clearNdaFields,
	persistNdaDraftRequestId,
	persistNdaProvisioned,
	recordNdaError,
} from '../signature/persist';
import {
	alertFinalFailure,
	formatErrorDetail,
	notifyOps,
	withJobLifecycleAlerts,
} from '../services/slack';
import { resolveDefaultSignatureProvider } from '../signature/providers';
import { isNdaFullyProvisioned } from '../signature/helpers';
import { resolveExternalRequestId } from '../signature/nda-request';
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
				await recordNdaError(enrollmentId, `Création NDA — ${detail}`);
			}
			await alertFinalFailure({
				title: 'Échec définitif création NDA',
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
			jobLabel: 'Création NDA',
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

				const signature = resolveDefaultSignatureProvider();
				const existingRequestId = resolveExternalRequestId(enrollment);
				const requestId =
					(!isRecreate && existingRequestId) ||
					(await step.run('create-nda-draft', async () => {
						const draft = await signature.provisionNda({
							step: 'draft',
							enrollmentId: enrollment.id,
							email: enrollment.user.email,
							firstName: enrollment.user.firstName,
							lastName: enrollment.user.lastName,
						});
						return draft.requestId;
					}));

				if (isRecreate || !existingRequestId) {
					await step.run('persist-nda-draft-id', async () => {
						await persistNdaDraftRequestId(enrollment.id, requestId);
					});
				}

				const nda = await step.run('activate-nda', async () => {
					const activated = await signature.provisionNda({ step: 'activate', requestId });
					if (!('signerId' in activated)) {
						throw new Error('Signature: activation sans signataire');
					}
					return activated;
				});

				await step.run('persist-nda', async () => {
					await persistNdaProvisioned(enrollment.id, {
						requestId: nda.requestId,
						signerId: nda.signerId,
						signatureLink: 'signatureLink' in nda ? nda.signatureLink : undefined,
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
