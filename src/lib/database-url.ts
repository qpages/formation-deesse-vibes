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
		DEV_DATABASE_URL: fromVite('DEV_DATABASE_URL') ?? process.env.DEV_DATABASE_URL,
		PRODUCTION_DATABASE_URL:
			fromVite('PRODUCTION_DATABASE_URL') ?? process.env.PRODUCTION_DATABASE_URL,
	};
}

export function resolveDatabaseUrl(
	env: EnvLike = defaultEnv(),
	prod = env.NODE_ENV === 'production',
): string {
	const key = prod ? 'PRODUCTION_DATABASE_URL' : 'DEV_DATABASE_URL';
	const url = env[key]?.trim();
	if (!url) throw new Error(`${key} is required`);
	return url;
}
