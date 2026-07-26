import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal('').transform(() => undefined));

const serverSchema = z.object({
	DATABASE_URL: z.string().min(1).optional(),
	STRIPE_SECRET_KEY: z.string().optional(),
	STRIPE_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_PRICE_ID: z.string().default('price_1TxMhyL7BRlbDDBVn3MZlfBD'),
	STRIPE_AMOUNT_CENTS: z.coerce.number().int().positive().default(32000),
	YOUSIGN_API_KEY: z.string().optional(),
	YOUSIGN_TEMPLATE_ID: z.string().optional(),
	YOUSIGN_WEBHOOK_SECRET: z.string().optional(),
	YOUSIGN_API_BASE: z.string().url().default('https://api-sandbox.yousign.app/v3'),
	RESEND_API_KEY: z.string().optional(),
	RESEND_FROM: z.string().default('formation@deesse-vibes.com'),
	MAGIC_LINK_SECRET: z.string().min(32).optional(),
	SESSION_SECRET: z.string().min(32).optional(),
	PAYLOAD_ENCRYPTION_KEY: z.string().min(32).optional(),
	INNGEST_EVENT_KEY: z.string().optional(),
	INNGEST_SIGNING_KEY: z.string().optional(),
	MAKE_WEBHOOK_URL: optionalUrl,
	SLACK_WEBHOOK_URL: optionalUrl,
	ADMIN_EMAIL: z.string().email().default('admin@deesse-vibes.com'),
	ADMIN_PASSWORD: z.string().min(1).default(''),
	PUBLIC_SITE_URL: z.string().url().default('http://localhost:4321'),
	PUBLIC_ADMIN_CONTACT_EMAIL: z.string().email().default('admin@deesse-vibes.com'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
	if (cached) return cached;
	cached = serverSchema.parse({
		DATABASE_URL: import.meta.env.DATABASE_URL ?? process.env.DATABASE_URL,
		STRIPE_SECRET_KEY: import.meta.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY,
		STRIPE_WEBHOOK_SECRET:
			import.meta.env.STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET,
		STRIPE_PRICE_ID: import.meta.env.STRIPE_PRICE_ID ?? process.env.STRIPE_PRICE_ID,
		STRIPE_AMOUNT_CENTS:
			import.meta.env.STRIPE_AMOUNT_CENTS ?? process.env.STRIPE_AMOUNT_CENTS,
		YOUSIGN_API_KEY: import.meta.env.YOUSIGN_API_KEY ?? process.env.YOUSIGN_API_KEY,
		YOUSIGN_TEMPLATE_ID:
			import.meta.env.YOUSIGN_TEMPLATE_ID ?? process.env.YOUSIGN_TEMPLATE_ID,
		YOUSIGN_WEBHOOK_SECRET:
			import.meta.env.YOUSIGN_WEBHOOK_SECRET ?? process.env.YOUSIGN_WEBHOOK_SECRET,
		YOUSIGN_API_BASE: import.meta.env.YOUSIGN_API_BASE ?? process.env.YOUSIGN_API_BASE,
		RESEND_API_KEY: import.meta.env.RESEND_API_KEY ?? process.env.RESEND_API_KEY,
		RESEND_FROM: import.meta.env.RESEND_FROM ?? process.env.RESEND_FROM,
		MAGIC_LINK_SECRET: import.meta.env.MAGIC_LINK_SECRET ?? process.env.MAGIC_LINK_SECRET,
		SESSION_SECRET: import.meta.env.SESSION_SECRET ?? process.env.SESSION_SECRET,
		PAYLOAD_ENCRYPTION_KEY:
			import.meta.env.PAYLOAD_ENCRYPTION_KEY ?? process.env.PAYLOAD_ENCRYPTION_KEY,
		INNGEST_EVENT_KEY: import.meta.env.INNGEST_EVENT_KEY ?? process.env.INNGEST_EVENT_KEY,
		INNGEST_SIGNING_KEY:
			import.meta.env.INNGEST_SIGNING_KEY ?? process.env.INNGEST_SIGNING_KEY,
		MAKE_WEBHOOK_URL: import.meta.env.MAKE_WEBHOOK_URL ?? process.env.MAKE_WEBHOOK_URL,
		SLACK_WEBHOOK_URL: import.meta.env.SLACK_WEBHOOK_URL ?? process.env.SLACK_WEBHOOK_URL,
		ADMIN_EMAIL: import.meta.env.ADMIN_EMAIL ?? process.env.ADMIN_EMAIL,
		ADMIN_PASSWORD: import.meta.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD,
		PUBLIC_SITE_URL: import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL,
		PUBLIC_ADMIN_CONTACT_EMAIL:
			import.meta.env.PUBLIC_ADMIN_CONTACT_EMAIL ??
			process.env.PUBLIC_ADMIN_CONTACT_EMAIL,
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
	priceLabel: '320 €',
	priceCents: 32000,
	currency: 'eur',
} as const;
