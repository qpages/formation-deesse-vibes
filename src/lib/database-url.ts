type EnvLike = Record<string, string | undefined>;

export function resolveDatabaseUrl(
	env: EnvLike = process.env,
	prod = env.NODE_ENV === 'production',
): string {
	const key = prod ? 'PRODUCTION_DATABASE_URL' : 'DEV_DATABASE_URL';
	const url = env[key]?.trim();
	if (!url) throw new Error(`${key} is required`);
	return url;
}
