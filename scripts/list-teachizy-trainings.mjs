#!/usr/bin/env node
/**
 * Liste les formations Teachizy et écrit le résultat dans formations.json.
 * Usage: node scripts/list-teachizy-trainings.mjs
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiKey = process.env.TEACHIZY_API_KEY;
const baseUrl = (process.env.TEACHIZY_API_BASE ?? 'https://api.teachizy.fr/api/v1').replace(
	/\/$/,
	'',
);

if (!apiKey) {
	console.error('Missing TEACHIZY_API_KEY in .env');
	process.exit(1);
}

const url = `${baseUrl}/externals/automations/trainings`;
const response = await fetch(url, {
	headers: {
		Authorization: `Bearer ${apiKey}`,
		Accept: 'application/json',
	},
});

if (!response.ok) {
	const body = await response.text();
	console.error(`Teachizy API error ${response.status}: ${body}`);
	process.exit(1);
}

const payload = await response.json();
const outPath = resolve(process.cwd(), 'formations.json');
await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const count = Array.isArray(payload?.data) ? payload.data.length : '?';
console.log(`Wrote ${count} formation(s) → ${outPath}`);
