import { Inngest } from 'inngest';
import { env } from '../env';

/**
 * Configuration du client Inngest
 *
 * **Mode développement** (INNGEST_DEV=1 ou import.meta.env.DEV === true):
 * - Se connecte au dev server local (port 8288)
 * - Pas de clé API requise
 * - Lancé via `npm run inngest:dev`
 *
 * **Mode production** (INNGEST_DEV !== 1):
 * - Se connecte à Inngest Cloud
 * - Requiert INNGEST_EVENT_KEY
 * - Auto-découverte via l'endpoint /api/inngest
 *
 * @see docs/overview.md#inngest
 */
const isDev = env.INNGEST_DEV === '1' || import.meta.env.DEV || import.meta.env.MODE === 'development';

export const inngest = new Inngest({
	id: 'formation-deesse-vibes',
	name: 'Formation Déesse Vibes',
	eventKey: isDev ? undefined : env.INNGEST_EVENT_KEY,
	isDev,
});

/**
 * Types TypeScript pour tous les événements Inngest de l'application
 *
 * Ces types garantissent la cohérence des payloads entre l'envoi
 * (inngest.send) et la réception (fonction handler).
 */
export type AppEvents = {
	/** Déclenché après confirmation d'un paiement Stripe */
	'stripe/payment.confirmed': {
		data: { enrollmentId: string; stripeEventId: string };
	};
	/** Déclenché après signature d'un NDA Yousign */
	'yousign/signature.done': {
		data: { enrollmentId: string; yousignEventId: string; requestId: string };
	};
	/** Événement cron pour la purge des anciens webhooks (interne) */
	'ops/purge-webhook-payloads': {
		data: Record<string, never>;
	};
};
