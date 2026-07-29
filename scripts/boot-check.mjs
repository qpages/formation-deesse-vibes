#!/usr/bin/env node
/**
 * Vérifie ENV + connexions critiques. Exit 1 si KO.
 * Usage: node scripts/boot-check.mjs [--prod]
 */
import 'dotenv/config';
import pg from 'pg';
import Stripe from 'stripe';

const REQUIRED_ALWAYS = [
	'DATABASE_URL',
	'STRIPE_SECRET_KEY',
	'STRIPE_WEBHOOK_SECRET',
	'STRIPE_PRICE_ID',
	'YOUSIGN_API_KEY',
	'YOUSIGN_TEMPLATE_ID',
	'YOUSIGN_WEBHOOK_SECRET',
	'RESEND_API_KEY',
	'MAGIC_LINK_SECRET',
	'SESSION_SECRET',
	'PAYLOAD_ENCRYPTION_KEY',
	'TEACHIZY_API_KEY',
	'TEACHIZY_TRAINING_UUID',
	'ADMIN_PASSWORD',
	'PUBLIC_SITE_URL',
];

const REQUIRED_PROD = ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'];
const SECRET_MIN = ['MAGIC_LINK_SECRET', 'SESSION_SECRET', 'PAYLOAD_ENCRYPTION_KEY'];
const PROBE_MS = 8_000;

const isProd =
	process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

function blank(value) {
	return value === undefined || value === null || value === '';
}

/** @returns {{ key: string, message: string }[]} */
export function checkRequiredEnv(env = process.env, { prod = isProd } = {}) {
	const issues = [];
	const keys = prod ? [...REQUIRED_ALWAYS, ...REQUIRED_PROD] : [...REQUIRED_ALWAYS];

	for (const key of keys) {
		if (blank(env[key])) {
			issues.push({ key, message: 'variable manquante ou vide' });
		}
	}

	for (const key of SECRET_MIN) {
		const value = env[key];
		if (typeof value === 'string' && value.length > 0 && value.length < 32) {
			issues.push({ key, message: 'doit faire au moins 32 caractères' });
		}
	}

	if (prod && env.ADMIN_PASSWORD === 'ChangeMeNow!') {
		issues.push({
			key: 'ADMIN_PASSWORD',
			message: 'mot de passe par défaut interdit en production',
		});
	}

	return issues;
}

async function withTimeout(label, ms, fn) {
	let timer;
	try {
		return await Promise.race([
			fn(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`timeout après ${ms}ms`)), ms);
			}),
		]);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`${label}: ${detail}`);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function probeDatabase(env) {
	const client = new pg.Client({
		connectionString: env.DATABASE_URL,
		connectionTimeoutMillis: PROBE_MS,
	});
	try {
		await withTimeout('Postgres', PROBE_MS, async () => {
			await client.connect();
			await client.query('SELECT 1');
		});
		return null;
	} catch (error) {
		return {
			key: 'DATABASE_URL',
			message: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await client.end().catch(() => {});
	}
}

async function probeStripe(env) {
	try {
		await withTimeout('Stripe', PROBE_MS, async () => {
			const stripe = new Stripe(env.STRIPE_SECRET_KEY);
			await stripe.prices.retrieve(env.STRIPE_PRICE_ID);
		});
		return null;
	} catch (error) {
		return {
			key: 'STRIPE_SECRET_KEY',
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function probeYousign(env) {
	const base = env.YOUSIGN_API_BASE || 'https://api-sandbox.yousign.app/v3';
	try {
		await withTimeout('Yousign', PROBE_MS, async () => {
			const res = await fetch(`${base}/templates?limit=100`, {
				headers: {
					Authorization: `Bearer ${env.YOUSIGN_API_KEY}`,
					Accept: 'application/json',
				},
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
			}
			const body = await res.json();
			const ids = Array.isArray(body?.data)
				? body.data.map((t) => t?.id).filter(Boolean)
				: [];
			if (!ids.includes(env.YOUSIGN_TEMPLATE_ID)) {
				throw new Error(
					`template ${env.YOUSIGN_TEMPLATE_ID} introuvable (vérifie YOUSIGN_TEMPLATE_ID)`,
				);
			}
		});
		return null;
	} catch (error) {
		return {
			key: 'YOUSIGN_API_KEY',
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function probeConnections(env = process.env) {
	const results = await Promise.all([
		probeDatabase(env),
		probeStripe(env),
		probeYousign(env),
	]);
	return results.filter(Boolean);
}

export async function runBootCheck(env = process.env, { prod = isProd } = {}) {
	const issues = [...checkRequiredEnv(env, { prod })];
	if (issues.length === 0) {
		issues.push(...(await probeConnections(env)));
	}
	return issues;
}

function printIssues(issues) {
	console.error('\n✗ Configuration invalide\n');
	for (const issue of issues) {
		console.error(`  • ${issue.key} — ${issue.message}`);
	}
	console.error('\nCorrige .env (local) ou les secrets Vercel, puis relance.\n');
}

async function main() {
	const issues = await runBootCheck(process.env, { prod: isProd });
	if (issues.length > 0) {
		printIssues(issues);
		process.exit(1);
	}
	console.log('✓ ENV + connexions OK' + (isProd ? ' (prod)' : ' (dev)'));
}

const isDirectRun =
	process.argv[1] &&
	(process.argv[1].endsWith('boot-check.mjs') ||
		process.argv[1].endsWith('boot-check.js'));

if (isDirectRun) {
	main().catch((error) => {
		console.error('✗ boot-check a planté:', error);
		process.exit(1);
	});
}
