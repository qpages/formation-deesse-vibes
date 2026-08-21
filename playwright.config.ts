import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';

config();

const port = Number(process.env.E2E_PORT ?? 4322);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	webServer: {
		command: `npx astro dev --port ${port} --host 127.0.0.1 --force`,
		url: baseURL,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			...process.env,
			E2E_MOCK_PROVIDERS: '1',
			SIGNATURE_PROVIDER: process.env.SIGNATURE_PROVIDER ?? 'docuseal',
			SIGNATURE_MODE: process.env.SIGNATURE_MODE ?? 'embed',
			SLACK_WEBHOOK_URL: '',
			INNGEST_DEV: '1',
			PUBLIC_SITE_URL: baseURL,
			STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_e2e_mock_not_a_live_key_xxxxx',
			STRIPE_WEBHOOK_SECRET:
				process.env.STRIPE_WEBHOOK_SECRET || 'whsec_e2e_playwright_dummy_secret_xx',
			DOCUSEAL_WEBHOOK_SECRET:
				process.env.DOCUSEAL_WEBHOOK_SECRET || 'whsec_e2e_docuseal_webhook_secret_xx',
			ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@deesse-vibes.com',
			ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'e2e-admin-password',
		},
	},
});
