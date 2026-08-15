import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal('').transform(() => undefined));

const serverSchema = z.object({
	STRIPE_SECRET_KEY: z.string().optional(),
	STRIPE_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_PRICE_ID: z.string().default('price_1TzdF3L7BRlbDDBVihIiFWwp'),
	STRIPE_PRICE_UNIQUE: z.string().optional(),
	STRIPE_PRICE_X2: z.string().optional(),
	STRIPE_PRICE_X4: z.string().optional(),
	STRIPE_PRICE_X6: z.string().optional(),
	STRIPE_AMOUNT_CENTS: z.coerce.number().int().positive().default(184_900),
	YOUSIGN_API_KEY: z.string().optional(),
	YOUSIGN_TEMPLATE_ID: z.string().optional(),
	YOUSIGN_WEBHOOK_SECRET: z.string().optional(),
	YOUSIGN_API_BASE: z.string().url().default('https://api-sandbox.yousign.app/v3'),
	YOUSIGN_SIGNER_LABEL: z.string().default('signer'),
	BREVO_API_KEY: z.string().optional(),
	BREVO_FROM: z.string().default('formation@deesse-vibes.com'),
	MAGIC_LINK_SECRET: z.string().min(32).optional(),
	SESSION_SECRET: z.string().min(32).optional(),
	PAYLOAD_ENCRYPTION_KEY: z.string().min(32).optional(),
	INNGEST_DEV: z.string().optional(),
	INNGEST_EVENT_KEY: z.string().optional(),
	INNGEST_SIGNING_KEY: z.string().optional(),
	TEACHIZY_API_KEY: z.string().optional(),
	TEACHIZY_API_BASE: z.string().url().default('https://api.teachizy.fr/api/v1'),
	TEACHIZY_TRAINING_UUID: z.string().optional(),
	SLACK_WEBHOOK_URL: optionalUrl,
	ADMIN_EMAIL: z.string().email().default('admin@deesse-vibes.com'),
	ADMIN_PASSWORD: z.string().min(1).default(''),
	PUBLIC_SITE_URL: z.string().url().default('http://localhost:4321'),
	PUBLIC_ADMIN_CONTACT_EMAIL: z.string().email().default('admin@deesse-vibes.com'),
	PUBLIC_WHATSAPP_NUMBER: z.preprocess(
		(value) => (value === '' || value === undefined || value === null ? undefined : value),
		z
			.string()
			.regex(/^\d+$/, 'PUBLIC_WHATSAPP_NUMBER must be digits only (e.g. 33612345678)')
			.optional(),
	),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/** Vite compile-time: true only for `astro dev` / `vite --mode development`. */
export const isDev = import.meta.env.DEV;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
	if (cached) return cached;
	cached = serverSchema.parse({
		STRIPE_SECRET_KEY: import.meta.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY,
		STRIPE_WEBHOOK_SECRET:
			import.meta.env.STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET,
		STRIPE_PRICE_ID: import.meta.env.STRIPE_PRICE_ID ?? process.env.STRIPE_PRICE_ID,
		STRIPE_PRICE_UNIQUE:
			import.meta.env.STRIPE_PRICE_UNIQUE ??
			process.env.STRIPE_PRICE_UNIQUE ??
			import.meta.env.STRIPE_PRICE_ID ??
			process.env.STRIPE_PRICE_ID,
		STRIPE_PRICE_X2: import.meta.env.STRIPE_PRICE_X2 ?? process.env.STRIPE_PRICE_X2,
		STRIPE_PRICE_X4: import.meta.env.STRIPE_PRICE_X4 ?? process.env.STRIPE_PRICE_X4,
		STRIPE_PRICE_X6: import.meta.env.STRIPE_PRICE_X6 ?? process.env.STRIPE_PRICE_X6,
		STRIPE_AMOUNT_CENTS:
			import.meta.env.STRIPE_AMOUNT_CENTS ?? process.env.STRIPE_AMOUNT_CENTS,
		YOUSIGN_API_KEY: import.meta.env.YOUSIGN_API_KEY ?? process.env.YOUSIGN_API_KEY,
		YOUSIGN_TEMPLATE_ID:
			import.meta.env.YOUSIGN_TEMPLATE_ID ?? process.env.YOUSIGN_TEMPLATE_ID,
		YOUSIGN_WEBHOOK_SECRET:
			import.meta.env.YOUSIGN_WEBHOOK_SECRET ?? process.env.YOUSIGN_WEBHOOK_SECRET,
		YOUSIGN_API_BASE: import.meta.env.YOUSIGN_API_BASE ?? process.env.YOUSIGN_API_BASE,
		YOUSIGN_SIGNER_LABEL:
			import.meta.env.YOUSIGN_SIGNER_LABEL ?? process.env.YOUSIGN_SIGNER_LABEL,
		BREVO_API_KEY: import.meta.env.BREVO_API_KEY ?? process.env.BREVO_API_KEY,
		BREVO_FROM: import.meta.env.BREVO_FROM ?? process.env.BREVO_FROM,
		MAGIC_LINK_SECRET: import.meta.env.MAGIC_LINK_SECRET ?? process.env.MAGIC_LINK_SECRET,
		SESSION_SECRET: import.meta.env.SESSION_SECRET ?? process.env.SESSION_SECRET,
		PAYLOAD_ENCRYPTION_KEY:
			import.meta.env.PAYLOAD_ENCRYPTION_KEY ?? process.env.PAYLOAD_ENCRYPTION_KEY,
		INNGEST_DEV: import.meta.env.INNGEST_DEV ?? process.env.INNGEST_DEV,
		INNGEST_EVENT_KEY: import.meta.env.INNGEST_EVENT_KEY ?? process.env.INNGEST_EVENT_KEY,
		INNGEST_SIGNING_KEY:
			import.meta.env.INNGEST_SIGNING_KEY ?? process.env.INNGEST_SIGNING_KEY,
		TEACHIZY_API_KEY: import.meta.env.TEACHIZY_API_KEY ?? process.env.TEACHIZY_API_KEY,
		TEACHIZY_API_BASE: import.meta.env.TEACHIZY_API_BASE ?? process.env.TEACHIZY_API_BASE,
		TEACHIZY_TRAINING_UUID:
			import.meta.env.TEACHIZY_TRAINING_UUID ?? process.env.TEACHIZY_TRAINING_UUID,
		SLACK_WEBHOOK_URL: import.meta.env.SLACK_WEBHOOK_URL ?? process.env.SLACK_WEBHOOK_URL,
		ADMIN_EMAIL: import.meta.env.ADMIN_EMAIL ?? process.env.ADMIN_EMAIL,
		ADMIN_PASSWORD: import.meta.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD,
		PUBLIC_SITE_URL: import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL,
		PUBLIC_ADMIN_CONTACT_EMAIL:
			import.meta.env.PUBLIC_ADMIN_CONTACT_EMAIL ??
			process.env.PUBLIC_ADMIN_CONTACT_EMAIL,
		PUBLIC_WHATSAPP_NUMBER:
			import.meta.env.PUBLIC_WHATSAPP_NUMBER ?? process.env.PUBLIC_WHATSAPP_NUMBER,
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
	priceLabel: '1 849 €',
	priceCents: 184_900,
	currency: 'eur',
} as const;

export const env = getEnv();
