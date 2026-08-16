import { describe, expect, it } from 'vitest';
import {
	PRISMA_CLI_PLACEHOLDER_URL,
	isProductionDatabase,
	prismaCliTouchesDatabase,
	resolveDatabaseUrl,
	resolvePrismaCliDatasourceUrl,
} from './database-url';

const urls = {
	DEV_DATABASE_URL: 'postgresql://dev@localhost:5434/formation_deesse_vibes',
	PRODUCTION_DATABASE_URL: 'postgresql://prod@db.example:5432/formation_deesse_vibes',
};

describe('isProductionDatabase', () => {
	it('reste local sans NODE_ENV ni Vercel', () => {
		expect(isProductionDatabase({})).toBe(false);
	});

	it('suit NODE_ENV=production', () => {
		expect(isProductionDatabase({ NODE_ENV: 'production' })).toBe(true);
	});

	it('traite tout build Vercel comme prod (NODE_ENV souvent absent du CLI Prisma)', () => {
		expect(isProductionDatabase({ VERCEL: '1' })).toBe(true);
		expect(isProductionDatabase({ VERCEL_ENV: 'preview' })).toBe(true);
		expect(isProductionDatabase({ VERCEL_ENV: 'production' })).toBe(true);
	});
});

describe('resolveDatabaseUrl', () => {
	it('utilise DEV_DATABASE_URL en local', () => {
		expect(resolveDatabaseUrl(urls)).toBe(urls.DEV_DATABASE_URL);
	});

	it('utilise PRODUCTION_DATABASE_URL sur Vercel', () => {
		expect(resolveDatabaseUrl({ ...urls, VERCEL: '1' })).toBe(urls.PRODUCTION_DATABASE_URL);
	});

	it('exige PRODUCTION_DATABASE_URL sur Vercel', () => {
		expect(() =>
			resolveDatabaseUrl({ VERCEL: '1', DEV_DATABASE_URL: urls.DEV_DATABASE_URL }),
		).toThrow('PRODUCTION_DATABASE_URL is required');
	});
});

describe('prismaCliTouchesDatabase', () => {
	it('false pour postinstall / generate / validate / format', () => {
		expect(prismaCliTouchesDatabase(['node', 'prisma', 'generate'])).toBe(false);
		expect(prismaCliTouchesDatabase(['node', 'prisma', 'validate'])).toBe(false);
		expect(prismaCliTouchesDatabase(['node', 'prisma', 'format'])).toBe(false);
		expect(prismaCliTouchesDatabase(['node', 'prisma'], 'postinstall')).toBe(false);
	});

	it('true pour migrate / studio', () => {
		expect(prismaCliTouchesDatabase(['node', 'prisma', 'migrate', 'deploy'])).toBe(true);
		expect(prismaCliTouchesDatabase(['node', 'prisma', 'studio'])).toBe(true);
	});
});

describe('resolvePrismaCliDatasourceUrl', () => {
	it('placeholder si generate sans URL (CI GitHub)', () => {
		expect(resolvePrismaCliDatasourceUrl({}, false, false)).toBe(PRISMA_CLI_PLACEHOLDER_URL);
	});

	it('échoue si migrate sans URL', () => {
		expect(() => resolvePrismaCliDatasourceUrl({}, false, true)).toThrow(
			'DEV_DATABASE_URL is required',
		);
	});

	it('préfère l’URL réelle même pour generate', () => {
		expect(resolvePrismaCliDatasourceUrl(urls, false, false)).toBe(urls.DEV_DATABASE_URL);
	});
});
