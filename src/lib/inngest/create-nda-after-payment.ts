import { isPaidEnough } from '../enrollment-gates';
import { findEnrollmentByIdOrThrow } from '../enrollment';
import {
	clearNdaFields,
	ensureNdaContractSentIfProvisioned,
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
import { resolveSignatureConfig } from '../signature/config';
import { resolveSignatureProvider } from '../signature/providers';
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
					await step.run('mirror-contract-sent-if-provisioned', async () => {
						const fresh = await findEnrollmentByIdOrThrow(enrollmentId);
						await ensureNdaContractSentIfProvisioned(fresh);
					});
					return { skipped: true, reason: 'nda_already_created' };
				}

				if (!isPaidEnough(enrollment.collectionStatus)) {
					throw new Error(
						`Paiement pas encore confirmé (collection_${enrollment.collectionStatus}) — retry`,
					);
				}

				if (isRecreate) {
					await step.run('clear-nda-ids', async () => {
						await clearNdaFields(enrollment.id);
					});
				}

				const signatureConfig = resolveSignatureConfig();
				const signature = resolveSignatureProvider(signatureConfig.provider);
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
						await persistNdaDraftRequestId(enrollment.id, requestId, signatureConfig);
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
					await persistNdaProvisioned(
						enrollment.id,
						{
							requestId: nda.requestId,
							signerId: nda.signerId,
							signatureLink: 'signatureLink' in nda ? nda.signatureLink : undefined,
						},
						signatureConfig,
					);
				});

				await step.run('mirror-contract-sent-if-provisioned', async () => {
					const fresh = await findEnrollmentByIdOrThrow(enrollmentId);
					await ensureNdaContractSentIfProvisioned(fresh);
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
