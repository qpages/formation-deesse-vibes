import { Inngest } from 'inngest';
import { e2eMockProviders } from '../e2e-providers';
import { env, isInngestDevMode } from '../env';

/**
 * Configuration du client Inngest
 *
 * **Mode développement** (INNGEST_DEV=1 ou import.meta.env.DEV === true):
 * - Se connecte au dev server local (port 8288)
 * - Pas de clé API requise
 * - Lancé via `pnpm dev:inngest`
 *
 * **Mode production** (INNGEST_DEV !== 1):
 * - Se connecte à Inngest Cloud
 * - Requiert INNGEST_EVENT_KEY
 * - Auto-découverte via l'endpoint /api/inngest
 */
const isDev = isInngestDevMode(env.INNGEST_DEV);

export const inngest = new Inngest({
	id: 'formation-deesse-vibes',
	name: 'Formation Déesse Vibes',
	eventKey: isDev ? undefined : env.INNGEST_EVENT_KEY,
	isDev,
});

/**
 * Résultat d'un enqueue Inngest côté effet secondaire (post-condition).
 * `skipped` = rien à faire (gates non remplies). `failed` = file indisponible.
 */
export type EnqueueResult =
	{ status: 'enqueued' } | { status: 'skipped' } | { status: 'failed'; error: string };

/**
 * `inngest.send` qui ne jette jamais : isole une panne de la file (dev sans
 * `dev:inngest`, réseau) de l'effet primaire déjà persisté en base.
 * Les appelants « durs » (webhook) re-jettent sur `failed` pour garder le retry.
 */
export async function sendInngestSafe(
	payload: Parameters<typeof inngest.send>[0],
): Promise<{ status: 'enqueued' } | { status: 'failed'; error: string }> {
	if (e2eMockProviders()) {
		return { status: 'enqueued' };
	}
	try {
		await inngest.send(payload);
		return { status: 'enqueued' };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[inngest.send] échec enqueue', message);
		return { status: 'failed', error: message };
	}
}

export type AppEvents = {
	'stripe/payment.confirmed': {
		data: { enrollmentId: string; stripeEventId: string };
	};
	'nda/signature.completed': {
		data: { enrollmentId: string; providerEventId: string; requestId: string };
	};
	'provider/stripe-event.received': {
		data: { providerEventId: string };
	};
	'provider/yousign-event.received': {
		data: { providerEventId: string };
	};
	'provider/docuseal-event.received': {
		data: { providerEventId: string };
	};
	'enrollment/access.grant': {
		data: { enrollmentId: string };
	};
	'enrollment/access.suspend': {
		data: { enrollmentId: string; reason: 'OVERDUE_INSTALLMENT' };
	};
	'enrollment/access.revoke': {
		data: { enrollmentId: string };
	};
	'admin/resend-nda': {
		data: { enrollmentId: string };
	};
	'admin/recreate-nda': {
		data: { enrollmentId: string };
	};
	'ops/purge-webhook-payloads': {
		data: Record<string, never>;
	};
	'ops/reconcile-enrollments': {
		data: { enrollmentId?: string };
	};
};
