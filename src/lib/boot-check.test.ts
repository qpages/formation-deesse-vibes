import { describe, expect, it } from 'vitest';
import { checkRequiredEnv } from '../../scripts/boot-check.mjs';

function env(partial = {}) {
	return {
		DATABASE_URL: 'postgresql://u:p@localhost/db',
		STRIPE_SECRET_KEY: 'sk_test_x',
		STRIPE_WEBHOOK_SECRET: 'whsec_x',
		STRIPE_PRICE_ID: 'price_x',
		YOUSIGN_API_KEY: 'ys_x',
		YOUSIGN_TEMPLATE_ID: 'tpl_x',
		YOUSIGN_WEBHOOK_SECRET: 'secret',
		RESEND_API_KEY: 're_x',
		MAGIC_LINK_SECRET: 'x'.repeat(32),
		SESSION_SECRET: 'y'.repeat(32),
		PAYLOAD_ENCRYPTION_KEY: 'z'.repeat(32),
		INNGEST_EVENT_KEY: 'evt_x',
		INNGEST_SIGNING_KEY: 'signkey-x',
		TEACHIZY_API_KEY: 'tz_x',
		TEACHIZY_TRAINING_UUID: 'training-uuid',
		ADMIN_PASSWORD: 'secure-password',
		PUBLIC_SITE_URL: 'http://localhost:4321',
		...partial,
	};
}

describe('checkRequiredEnv', () => {
	it('passe avec un env complet', () => {
		expect(checkRequiredEnv(env(), { prod: false })).toEqual([]);
	});

	it('signale les variables manquantes', () => {
		const issues = checkRequiredEnv(
			env({ DATABASE_URL: undefined, YOUSIGN_API_KEY: '' }),
			{ prod: false },
		);
		expect(issues.map((i) => i.key).sort()).toEqual([
			'DATABASE_URL',
			'YOUSIGN_API_KEY',
		]);
	});

	it('exige Inngest en production seulement', () => {
		const withoutInngest = env({
			INNGEST_EVENT_KEY: undefined,
			INNGEST_SIGNING_KEY: undefined,
		});
		expect(checkRequiredEnv(withoutInngest, { prod: false })).toEqual([]);
		expect(
			checkRequiredEnv(withoutInngest, { prod: true }).map((i) => i.key).sort(),
		).toEqual(['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY']);
	});

	it('refuse le mot de passe admin par défaut en prod', () => {
		const issues = checkRequiredEnv(env({ ADMIN_PASSWORD: 'ChangeMeNow!' }), {
			prod: true,
		});
		expect(issues.some((i) => i.key === 'ADMIN_PASSWORD')).toBe(true);
	});
});
