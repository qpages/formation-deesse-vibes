type EnvLike = Record<string, string | undefined>;

function fromVite(key: 'DEV_DATABASE_URL' | 'PRODUCTION_DATABASE_URL'): string | undefined {
	const viteEnv = import.meta.env;
	if (!viteEnv) return undefined;
	const value = viteEnv[key];
	return typeof value === 'string' ? value : undefined;
}

function defaultEnv(): EnvLike {
	return {
		NODE_ENV: process.env.NODE_ENV,
		VERCEL: process.env.VERCEL,
		VERCEL_ENV: process.env.VERCEL_ENV,
		DEV_DATABASE_URL: fromVite('DEV_DATABASE_URL') ?? process.env.DEV_DATABASE_URL,
		PRODUCTION_DATABASE_URL:
			fromVite('PRODUCTION_DATABASE_URL') ?? process.env.PRODUCTION_DATABASE_URL,
	};
}

/** Prisma `generate` / `validate` do not connect; URL is still required by prisma.config.ts. */
export const PRISMA_CLI_PLACEHOLDER_URL = 'postgresql://prisma:generate@127.0.0.1:5432/prisma';

/** Local Docker URL must never be used on Vercel (`VERCEL=1`). */
export function isProductionDatabase(env: EnvLike = defaultEnv()): boolean {
	if (env.VERCEL === '1' || env.VERCEL === 'true') return true;
	if (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview') return true;
	return env.NODE_ENV === 'production';
}

function databaseUrlKey(prod: boolean): 'PRODUCTION_DATABASE_URL' | 'DEV_DATABASE_URL' {
	return prod ? 'PRODUCTION_DATABASE_URL' : 'DEV_DATABASE_URL';
}

export function resolveDatabaseUrl(
	env: EnvLike = defaultEnv(),
	prod = isProductionDatabase(env),
): string {
	const key = databaseUrlKey(prod);
	const url = env[key]?.trim();
	if (!url) throw new Error(`${key} is required`);
	return url;
}

/** Commands that only read the schema — safe without a live database. */
export function prismaCliTouchesDatabase(
	argv: readonly string[] = process.argv,
	lifecycleEvent = process.env.npm_lifecycle_event,
): boolean {
	if (lifecycleEvent === 'postinstall') return false;
	return !argv.some((token) => token === 'generate' || token === 'validate' || token === 'format');
}

export function resolvePrismaCliDatasourceUrl(
	env: EnvLike = defaultEnv(),
	prod = isProductionDatabase(env),
	touchesDatabase = prismaCliTouchesDatabase(),
): string {
	const key = databaseUrlKey(prod);
	const url = env[key]?.trim();
	if (url) return url;
	if (!touchesDatabase) return PRISMA_CLI_PLACEHOLDER_URL;
	throw new Error(`${key} is required`);
}
