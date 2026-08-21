import { z } from 'zod';

const optionalUrl = z
	.url()
	.optional()
	.or(z.literal('').transform(() => undefined));

const serverSchema = z
	.object({
		STRIPE_SECRET_KEY: z.string().optional(),
		STRIPE_WEBHOOK_SECRET: z.string().optional(),
		STRIPE_PRICE_ID: z.string().default('price_1TzdF3L7BRlbDDBVihIiFWwp'),
		STRIPE_PRICE_UNIQUE: z.string().optional(),
		STRIPE_PRICE_X2: z.string().optional(),
		STRIPE_PRICE_X4: z.string().optional(),
		STRIPE_PRICE_X6: z.string().optional(),
		YOUSIGN_API_KEY: z.string().optional(),
		YOUSIGN_TEMPLATE_ID: z.string().optional(),
		YOUSIGN_WEBHOOK_SECRET: z.string().optional(),
		YOUSIGN_API_BASE: z.url().default('https://api-sandbox.yousign.app/v3'),
		YOUSIGN_SIGNER_LABEL: z.string().default('signer'),
		SIGNATURE_PROVIDER: z.enum(['yousign', 'docuseal']).default('yousign'),
		SIGNATURE_MODE: z.enum(['embed', 'redirect']).optional(),
		DOCUSEAL_API_KEY: z.string().optional(),
		DOCUSEAL_WEBHOOK_SECRET: z.string().optional(),
		DOCUSEAL_TEMPLATE_ID: z.string().optional(),
		DOCUSEAL_API_BASE: z.url().default('https://api.docuseal.eu'),
		BREVO_API_KEY: z.string().optional(),
		BREVO_FROM: z.string().default('formation@deesse-vibes.com'),
		MAGIC_LINK_SECRET: z.string().min(32).optional(),
		SESSION_SECRET: z.string().min(32).optional(),
		PAYLOAD_ENCRYPTION_KEY: z.string().min(32).optional(),
		INNGEST_DEV: z.string().optional(),
		INNGEST_EVENT_KEY: z.string().optional(),
		INNGEST_SIGNING_KEY: z.string().optional(),
		TEACHIZY_API_KEY: z.string().optional(),
		TEACHIZY_API_BASE: z.url().default('https://api.teachizy.fr/api/v1'),
		TEACHIZY_TRAINING_UUID: z.string().optional(),
		SLACK_WEBHOOK_URL: optionalUrl,
		ADMIN_EMAIL: z.email().default('admin@deesse-vibes.com'),
		ADMIN_PASSWORD: z.string().min(1).default(''),
		PUBLIC_SITE_URL: z.url().default('http://localhost:4321'),
		PUBLIC_ADMIN_CONTACT_EMAIL: z.preprocess(
			(value) => (value === '' || value === undefined || value === null ? undefined : value),
			z.email().default('contact@deesse-vibes.com'),
		),
		PUBLIC_WHATSAPP_NUMBER: z.preprocess(
			(value) => (value === '' || value === undefined || value === null ? undefined : value),
			z
				.string()
				.regex(/^\d+$/, 'PUBLIC_WHATSAPP_NUMBER must be digits only (e.g. 33612345678)')
				.optional(),
		),
	})
	.superRefine((data, ctx) => {
		if (data.SIGNATURE_PROVIDER === 'yousign' && data.SIGNATURE_MODE === 'embed') {
			ctx.addIssue({
				code: 'custom',
				path: ['SIGNATURE_MODE'],
				message:
					'SIGNATURE_MODE=embed is not supported with SIGNATURE_PROVIDER=yousign. Use redirect (default) or omit SIGNATURE_MODE.',
			});
		}
	});

export type ServerEnv = z.infer<typeof serverSchema>;

/** Vite compile-time: true only for `astro dev` / `vite --mode development`. */
export const isDev = import.meta.env.DEV;

/**
 * `env.ts` is also reachable from Astro components that emit client code.
 * Never access Node's `process` from that bundle: it is not polyfilled by Vite.
 */
const runtimeEnv: NodeJS.ProcessEnv = import.meta.env.SSR ? globalThis.process.env : {};

/**
 * Inngest Cloud vs CLI local. A production Vercel build must never be "dev"
 * even if `INNGEST_DEV=1` leaked into the hosting env (syncs stay unattached).
 */
export function isInngestDevMode(inngestDev?: string): boolean {
	if (inngestDev === '0') return false;
	return import.meta.env.DEV;
}

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
	if (cached) return cached;
	cached = serverSchema.parse({
		STRIPE_SECRET_KEY: import.meta.env.STRIPE_SECRET_KEY ?? runtimeEnv.STRIPE_SECRET_KEY,
		STRIPE_WEBHOOK_SECRET:
			import.meta.env.STRIPE_WEBHOOK_SECRET ?? runtimeEnv.STRIPE_WEBHOOK_SECRET,
		STRIPE_PRICE_ID: import.meta.env.STRIPE_PRICE_ID ?? runtimeEnv.STRIPE_PRICE_ID,
		STRIPE_PRICE_UNIQUE:
			import.meta.env.STRIPE_PRICE_UNIQUE ??
			runtimeEnv.STRIPE_PRICE_UNIQUE ??
			import.meta.env.STRIPE_PRICE_ID ??
			runtimeEnv.STRIPE_PRICE_ID,
		STRIPE_PRICE_X2: import.meta.env.STRIPE_PRICE_X2 ?? runtimeEnv.STRIPE_PRICE_X2,
		STRIPE_PRICE_X4: import.meta.env.STRIPE_PRICE_X4 ?? runtimeEnv.STRIPE_PRICE_X4,
		STRIPE_PRICE_X6: import.meta.env.STRIPE_PRICE_X6 ?? runtimeEnv.STRIPE_PRICE_X6,
		YOUSIGN_API_KEY: import.meta.env.YOUSIGN_API_KEY ?? runtimeEnv.YOUSIGN_API_KEY,
		YOUSIGN_TEMPLATE_ID: import.meta.env.YOUSIGN_TEMPLATE_ID ?? runtimeEnv.YOUSIGN_TEMPLATE_ID,
		YOUSIGN_WEBHOOK_SECRET:
			import.meta.env.YOUSIGN_WEBHOOK_SECRET ?? runtimeEnv.YOUSIGN_WEBHOOK_SECRET,
		YOUSIGN_API_BASE: import.meta.env.YOUSIGN_API_BASE ?? runtimeEnv.YOUSIGN_API_BASE,
		YOUSIGN_SIGNER_LABEL: import.meta.env.YOUSIGN_SIGNER_LABEL ?? runtimeEnv.YOUSIGN_SIGNER_LABEL,
		SIGNATURE_PROVIDER: import.meta.env.SIGNATURE_PROVIDER ?? runtimeEnv.SIGNATURE_PROVIDER,
		SIGNATURE_MODE: import.meta.env.SIGNATURE_MODE ?? runtimeEnv.SIGNATURE_MODE,
		DOCUSEAL_API_KEY: import.meta.env.DOCUSEAL_API_KEY ?? runtimeEnv.DOCUSEAL_API_KEY,
		DOCUSEAL_WEBHOOK_SECRET:
			import.meta.env.DOCUSEAL_WEBHOOK_SECRET ?? runtimeEnv.DOCUSEAL_WEBHOOK_SECRET,
		DOCUSEAL_TEMPLATE_ID: import.meta.env.DOCUSEAL_TEMPLATE_ID ?? runtimeEnv.DOCUSEAL_TEMPLATE_ID,
		DOCUSEAL_API_BASE: import.meta.env.DOCUSEAL_API_BASE ?? runtimeEnv.DOCUSEAL_API_BASE,
		BREVO_API_KEY: import.meta.env.BREVO_API_KEY ?? runtimeEnv.BREVO_API_KEY,
		BREVO_FROM: import.meta.env.BREVO_FROM ?? runtimeEnv.BREVO_FROM,
		MAGIC_LINK_SECRET: import.meta.env.MAGIC_LINK_SECRET ?? runtimeEnv.MAGIC_LINK_SECRET,
		SESSION_SECRET: import.meta.env.SESSION_SECRET ?? runtimeEnv.SESSION_SECRET,
		PAYLOAD_ENCRYPTION_KEY:
			import.meta.env.PAYLOAD_ENCRYPTION_KEY ?? runtimeEnv.PAYLOAD_ENCRYPTION_KEY,
		INNGEST_DEV: import.meta.env.INNGEST_DEV ?? runtimeEnv.INNGEST_DEV,
		INNGEST_EVENT_KEY: import.meta.env.INNGEST_EVENT_KEY ?? runtimeEnv.INNGEST_EVENT_KEY,
		INNGEST_SIGNING_KEY: import.meta.env.INNGEST_SIGNING_KEY ?? runtimeEnv.INNGEST_SIGNING_KEY,
		TEACHIZY_API_KEY: import.meta.env.TEACHIZY_API_KEY ?? runtimeEnv.TEACHIZY_API_KEY,
		TEACHIZY_API_BASE: import.meta.env.TEACHIZY_API_BASE ?? runtimeEnv.TEACHIZY_API_BASE,
		TEACHIZY_TRAINING_UUID:
			import.meta.env.TEACHIZY_TRAINING_UUID ?? runtimeEnv.TEACHIZY_TRAINING_UUID,
		SLACK_WEBHOOK_URL: import.meta.env.SLACK_WEBHOOK_URL ?? runtimeEnv.SLACK_WEBHOOK_URL,
		ADMIN_EMAIL: import.meta.env.ADMIN_EMAIL ?? runtimeEnv.ADMIN_EMAIL,
		ADMIN_PASSWORD: import.meta.env.ADMIN_PASSWORD ?? runtimeEnv.ADMIN_PASSWORD,
		PUBLIC_SITE_URL: import.meta.env.PUBLIC_SITE_URL ?? runtimeEnv.PUBLIC_SITE_URL,
		PUBLIC_ADMIN_CONTACT_EMAIL:
			import.meta.env.PUBLIC_ADMIN_CONTACT_EMAIL ?? runtimeEnv.PUBLIC_ADMIN_CONTACT_EMAIL,
		PUBLIC_WHATSAPP_NUMBER:
			import.meta.env.PUBLIC_WHATSAPP_NUMBER ?? runtimeEnv.PUBLIC_WHATSAPP_NUMBER,
	});
	return cached;
}

export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
	const value = getEnv()[key];
	if (value === undefined || value === null || value === '') {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value as NonNullable<ServerEnv[K]>;
}

export function getAdminAllowlist(): string[] {
	const email = getEnv().ADMIN_EMAIL.trim().toLowerCase();
	return email ? [email] : [];
}

export const FORMATION = {
	name: 'Formation Matrice Évolution',
	brand: 'Déesse Vibes',
} as const;

export const env = getEnv();
