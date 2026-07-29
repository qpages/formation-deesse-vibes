import { getPrisma } from '../db';
import { alertFinalFailure } from '../services/slack';
import { inviteToTeachizy } from '../services/teachizy';
import {
	purgeOldWebhookPayloads,
	transitionStatus,
} from '../services/enrollment';
import {
	activateNdaRequest,
	createNdaDraft,
	isNdaFullyProvisioned,
} from '../services/yousign';
import { inngest } from './client';

/**
 * Fonction Inngest : Création du NDA Yousign après paiement confirmé
 *
 * **Trigger:** Event `stripe/payment.confirmed`
 *
 * **Flow:**
 * 1. Charge l'inscription depuis la base de données
 * 2. Skip si NDA déjà activé (requestId + signerId)
 * 3. Skip si status incompatible
 * 4. Crée un brouillon Yousign (ou reprend l'ID déjà persisté)
 * 5. Persiste yousignRequestId avant activate (idempotence retries)
 * 6. Active la demande (e-mail Yousign) — no-op si déjà hors draft
 * 7. Persiste signerId + statut métier
 *
 * **Retries:** 5 tentatives avec backoff exponentiel
 * **Échec final:** Alerte Slack envoyée
 *
 * @see docs/overview.md#inngest
 */
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

		if (isNdaFullyProvisioned(enrollment)) {
			return { skipped: true, reason: 'nda_already_created' };
		}

		if (
			enrollment.status !== 'paiement_confirme' &&
			enrollment.status !== 'nda_envoye'
		) {
			return { skipped: true, reason: `status_${enrollment.status}` };
		}

		const requestId =
			enrollment.yousignRequestId ??
			(await step.run('create-yousign-draft', async () => {
				const draft = await createNdaDraft({
					enrollmentId: enrollment.id,
					email: enrollment.email,
					firstName: enrollment.firstName,
					lastName: enrollment.lastName,
				});
				return draft.requestId;
			}));

		if (!enrollment.yousignRequestId) {
			await step.run('persist-yousign-draft-id', async () => {
				await getPrisma().enrollment.update({
					where: { id: enrollment.id },
					data: { yousignRequestId: requestId },
				});
			});
		}

		const nda = await step.run('activate-yousign-request', async () => {
			return activateNdaRequest(requestId);
		});

		await step.run('persist-nda', async () => {
			await getPrisma().enrollment.update({
				where: { id: enrollment.id },
				data: {
					yousignRequestId: nda.requestId,
					yousignSignerId: nda.signerId,
					yousignStatus: 'ongoing',
					status: 'nda_envoye',
				},
			});
		});

		return { requestId: nda.requestId };
	},
);

/**
 * Fonction Inngest : Invitation Teachizy après signature du NDA
 *
 * **Trigger:** Event `yousign/signature.done`
 *
 * **Flow:**
 * 1. Charge l'inscription depuis la base de données
 * 2. Skip si déjà invité (idempotence)
 * 3. Marque le NDA comme signé (transition status)
 * 4. Crée le compte apprenant sur Teachizy
 * 5. Inscrit à la formation
 * 6. Marque l'inscription comme complétée
 *
 * **Retries:** 5 tentatives avec backoff exponentiel
 * **Échec final:** Alerte Slack envoyée
 *
 * @see docs/overview.md#inngest
 */
export const inviteAfterNdaSigned = inngest.createFunction(
	{
		id: 'invite-after-nda-signed',
		retries: 5,
		triggers: [{ event: 'yousign/signature.done' }],
		onFailure: async ({ event, error }) => {
			const original = event.data as { event?: { data?: { enrollmentId?: string } } };
			await alertFinalFailure({
				title: 'Échec définitif invitation Teachizy',
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

		if (enrollment.teachizyInvitedAt || enrollment.status === 'teachizy_envoye') {
			return { skipped: true, reason: 'already_invited' };
		}

		await step.run('mark-nda-signed', async () => {
			await transitionStatus(enrollment.id, ['nda_envoye', 'paiement_confirme'], 'nda_signe');
		});

		await step.run('invite-teachizy', async () => {
			await inviteToTeachizy({
				enrollmentId: enrollment.id,
				email: enrollment.email,
				firstName: enrollment.firstName,
				lastName: enrollment.lastName,
			});
		});

		await step.run('mark-invited', async () => {
			await getPrisma().enrollment.update({
				where: { id: enrollment.id },
				data: {
					status: 'teachizy_envoye',
					teachizyInvitedAt: new Date(),
				},
			});
		});

		return { invited: true };
	},
);

/**
 * Fonction Inngest : Purge des anciens payloads webhook
 *
 * **Trigger:** Cron `0 3 * * *` (tous les jours à 3h du matin)
 *
 * **Flow:**
 * 1. Supprime tous les WebhookEvent de plus de 90 jours
 *
 * **Objectif:**
 * - Maintenance de la base de données
 * - Conformité RGPD (rétention limitée)
 *
 * **Retries:** 3 tentatives par défaut
 * **Échec final:** Log uniquement (non critique)
 *
 * @see docs/overview.md#inngest
 */
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
