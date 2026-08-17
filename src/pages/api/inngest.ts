/**
 * Endpoint Inngest pour Astro
 *
 * Expose trois méthodes HTTP pour la communication avec Inngest :
 *
 * - **GET** : Introspection - liste toutes les fonctions enregistrées
 * - **POST** : Exécution - reçoit et exécute les fonctions
 * - **PUT** : Enregistrement - utilisé par Inngest pour découvrir les fonctions
 *
 * **Développement local:**
 * - URL: http://localhost:4321/api/inngest
 * - Dashboard: http://localhost:8288
 * - Pas de clé de signature requise
 *
 * **Production:**
 * - URL: https://[votre-domaine]/api/inngest
 * - Requiert INNGEST_SIGNING_KEY pour authentification
 * - Auto-découvert par Inngest Cloud
 *
 * @see docs/overview.md#inngest
 */
import { serve } from 'inngest/astro';
import { inngest } from '../../lib/inngest/client';
import { inngestFunctions } from '../../lib/inngest/functions';
import { env, isInngestDevMode } from '../../lib/env';

const isDev = isInngestDevMode(env.INNGEST_DEV);

export const { GET, POST, PUT } = serve({
	client: inngest,
	functions: inngestFunctions,
	...(isDev ? {} : { signingKey: env.INNGEST_SIGNING_KEY }),
} as Parameters<typeof serve>[0]);
