#!/usr/bin/env node
/**
 * Pousse les variables de .env vers Vercel Production, uniquement si la clé n'existe pas déjà.
 * Usage: node scripts/vercel-env-push-prod.mjs [--env-file .env] [--dry-run]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const TARGET = 'production';
const SENSITIVE_RE = /SECRET|/i;
const SKIP_PREFIXES = ['VERCEL_'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const envFileFlag = args.indexOf('--env-file');
const envFile = envFileFlag >= 0 && args[envFileFlag + 1] ? args[envFileFlag + 1] : '.env';

function fail(message, extra) {
	console.error(`✗ ${message}`);
	if (extra) console.error(extra.trimEnd());
	process.exit(1);
}

function runVercel(cliArgs, { input } = {}) {
	const options = {
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
		input: input ?? undefined,
	};

	let result = spawnSync('vercel', cliArgs, options);
	if (result.error?.code === 'ENOENT') {
		result = spawnSync('npx', ['vercel', ...cliArgs], options);
	}
	if (result.error) {
		fail(`impossible d'exécuter vercel: ${result.error.message}`);
	}
	return result;
}

function parseLocalEnv(filePath) {
	if (!existsSync(filePath)) {
		fail(`fichier introuvable: ${filePath}`);
	}
	return parse(readFileSync(filePath, 'utf8'));
}

function shouldSkipKey(key) {
	return SKIP_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function listProductionKeys() {
	const result = runVercel(['env', 'ls', TARGET, '--json']);
	if (result.status !== 0) {
		fail('vercel env ls a échoué (projet lié ? `vercel link`)', result.stderr || result.stdout);
	}

	const raw = (result.stdout || '').trim();
	if (!raw) return new Set();

	try {
		const parsed = JSON.parse(raw);
		const rows = Array.isArray(parsed) ? parsed : (parsed.envs ?? parsed.variables ?? []);
		const keys = new Set();
		for (const row of rows) {
			const key = row.key ?? row.name ?? row.id;
			if (typeof key === 'string' && key) keys.add(key);
		}
		if (keys.size > 0 || Array.isArray(rows)) return keys;
	} catch {
		// fallback table
	}

	const keys = new Set();
	for (const line of raw.split('\n')) {
		const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s/);
		if (match) keys.add(match[1]);
	}
	return keys;
}

function addProductionEnv(key, value) {
	const cliArgs = ['env', 'add', key, TARGET, '--yes'];
	if (SENSITIVE_RE.test(key)) {
		cliArgs.push('--sensitive');
	}
	const result = runVercel(cliArgs, { input: value });
	if (result.status !== 0) {
		const combined = `${result.stderr || ''}\n${result.stdout || ''}`;
		if (/already exists|already been added/i.test(combined)) {
			return 'exists';
		}
		fail(`échec vercel env add ${key}`, combined);
	}
	return 'added';
}

const filePath = resolve(process.cwd(), envFile);
const local = parseLocalEnv(filePath);
const existing = listProductionKeys();

let added = 0;
let skippedExisting = 0;
let skippedEmpty = 0;
let skippedSystem = 0;

console.log(`Source: ${filePath}`);
console.log(`Cible: Vercel ${TARGET}${dryRun ? ' (dry-run)' : ''}`);
console.log(`Déjà présentes: ${existing.size}\n`);

for (const [key, value] of Object.entries(local)) {
	if (shouldSkipKey(key)) {
		skippedSystem += 1;
		console.log(`  · ${key} — ignorée (gérée par Vercel)`);
		continue;
	}
	if (value === undefined || value === '') {
		skippedEmpty += 1;
		console.log(`  · ${key} — ignorée (vide)`);
		continue;
	}
	if (existing.has(key)) {
		skippedExisting += 1;
		console.log(`  · ${key} — déjà présente, inchangée`);
		continue;
	}

	if (dryRun) {
		added += 1;
		console.log(`  + ${key} — serait ajoutée`);
		continue;
	}

	const status = addProductionEnv(key, value);
	if (status === 'exists') {
		skippedExisting += 1;
		console.log(`  · ${key} — déjà présente, inchangée`);
	} else {
		added += 1;
		existing.add(key);
		console.log(`  + ${key} — ajoutée`);
	}
}

console.log(
	`\n✓ ${added} ajoutée(s), ${skippedExisting} déjà présentes, ${skippedEmpty} vides, ${skippedSystem} ignorée(s)`,
);
