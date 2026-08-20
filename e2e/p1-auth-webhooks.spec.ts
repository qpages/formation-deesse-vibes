import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import Stripe from 'stripe';
import { enrollmentCookie, seedEnrollment, seedMagicLink, uniqueEmail } from './helpers/seed';

function webhookSecret() {
	return process.env.STRIPE_WEBHOOK_SECRET || 'whsec_e2e_playwright_dummy_secret_xx';
}

function signedStripeEvent(id: string) {
	const payload = JSON.stringify({
		id,
		object: 'event',
		api_version: '2026-01-28.clover',
		created: Math.floor(Date.now() / 1000),
		type: 'checkout.session.completed',
		data: {
			object: {
				id: 'cs_test_e2e_webhook',
				object: 'checkout.session',
			},
		},
		livemode: false,
		pending_webhooks: 1,
		request: { id: null, idempotency_key: null },
	});
	const signature = Stripe.webhooks.generateTestHeaderString({
		payload,
		secret: webhookSecret(),
	});
	return { payload, signature };
}

function docusealWebhookSecret() {
	return process.env.DOCUSEAL_WEBHOOK_SECRET || 'whsec_e2e_docuseal_webhook_secret_xx';
}

function signedDocusealPayload(body: Record<string, unknown>) {
	const payload = JSON.stringify(body);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac('sha256', docusealWebhookSecret())
		.update(`${timestamp}.${payload}`)
		.digest('hex');
	return { payload, signature: `${timestamp}.${signature}` };
}

function adminCredentials() {
	return {
		email: process.env.ADMIN_EMAIL || 'admin@deesse-vibes.com',
		password: process.env.ADMIN_PASSWORD || 'e2e-admin-password',
	};
}

test.describe('P1 magic link, admin, IDOR, webhooks', () => {
	test('1. magic link unused → cookie + /?connected=1', async ({ page, context }) => {
		const email = uniqueEmail('ml');
		const token = `e2e-ml-${Date.now()}`;
		const enrollment = await seedEnrollment({
			email,
			collectionStatus: 'paid',
			contractStatus: 'pending',
		});
		await seedMagicLink(enrollment.id, token);

		await page.goto(`/?token=${token}`);
		await expect(page.getByRole('heading', { name: 'Vous y êtes presque' })).toBeVisible();
		await page.getByRole('button', { name: 'Voir mon inscription' }).click();
		await page.waitForURL(/#acces/);

		const cookies = await context.cookies();
		expect(cookies.some((c) => c.name === 'dv_enrollment' && c.value)).toBeTruthy();
		await expect(page.locator('#access-tracking')).toBeVisible();
	});

	test('2. même lien utilisé, autre navigateur → /?link=invalid', async ({ browser }) => {
		const email = uniqueEmail('mlused');
		const token = `e2e-ml-used-${Date.now()}`;
		const enrollment = await seedEnrollment({
			email,
			collectionStatus: 'paid',
		});
		await seedMagicLink(enrollment.id, token, true);

		const other = await browser.newContext();
		const page = await other.newPage();
		const res = await page.goto(`/?token=${token}`);
		expect(res?.url() ?? page.url()).toMatch(/link=invalid/);
		await expect(page.locator('#access-funnel')).toBeVisible();
		await other.close();
	});

	test('3. magic-link/request connu et inconnu → même JSON 200', async ({ request }) => {
		const known = uniqueEmail('known');
		await seedEnrollment({
			email: known,
			collectionStatus: 'paid',
		});

		const knownRes = await request.post('/api/magic-link/request', {
			data: { email: known },
		});
		const unknownRes = await request.post('/api/magic-link/request', {
			data: { email: uniqueEmail('unknown') },
		});

		expect(knownRes.status()).toBe(200);
		expect(unknownRes.status()).toBe(200);
		expect(await knownRes.json()).toEqual(await unknownRes.json());
		expect((await knownRes.json()).ok).toBe(true);
	});

	test('4. /admin sans session → 302 login', async ({ request }) => {
		const res = await request.get('/admin/inscriptions', { maxRedirects: 0 });
		expect([302, 303, 401]).toContain(res.status());
		if (res.status() !== 401) {
			expect(res.headers().location ?? '').toMatch(/\/admin\/login/);
		}
	});

	test('5. nda/resend IDOR → 403', async ({ request }) => {
		const a = await seedEnrollment({
			email: uniqueEmail('studenta'),
			collectionStatus: 'current',
			contractStatus: 'sent',
		});
		const b = await seedEnrollment({
			email: uniqueEmail('studentb'),
			collectionStatus: 'current',
			contractStatus: 'sent',
		});
		const cookie = await enrollmentCookie(a.id);

		const res = await request.post('/api/nda/resend', {
			headers: { Cookie: `dv_enrollment=${cookie.value}` },
			data: { enrollmentId: b.id },
		});
		expect(res.status()).toBe(403);
	});

	test('6. webhook Stripe sans / mauvaise signature → 400', async ({ request }) => {
		const missing = await request.post('/api/webhooks/stripe', {
			data: '{}',
			headers: { 'content-type': 'application/json' },
		});
		expect(missing.status()).toBe(400);

		const bad = await request.post('/api/webhooks/stripe', {
			data: '{"id":"evt_x"}',
			headers: {
				'content-type': 'application/json',
				'stripe-signature': 't=1,v1=deadbeef',
			},
		});
		expect(bad.status()).toBe(400);
	});

	test('7. même événement Stripe deux fois → duplicate: true', async ({ request }) => {
		const eventId = `evt_e2e_${Date.now()}`;
		const { payload, signature } = signedStripeEvent(eventId);
		const headers = {
			'content-type': 'application/json',
			'stripe-signature': signature,
		};

		const first = await request.post('/api/webhooks/stripe', {
			data: payload,
			headers,
		});
		expect(first.status(), await first.text()).toBe(200);

		const second = await request.post('/api/webhooks/stripe', {
			data: payload,
			headers,
		});
		expect(second.status()).toBe(200);
		const body = await second.json();
		expect(body.duplicate).toBe(true);
	});

	test('8. nda PDF — matrice auth API', async ({ request }) => {
		const anonymous = await request.get('/api/enrollment/nda');
		expect(anonymous.status()).toBe(401);

		const unsigned = await seedEnrollment({
			email: uniqueEmail('nda-pdf-sent'),
			collectionStatus: 'paid',
			contractStatus: 'sent',
		});
		const unsignedCookie = await enrollmentCookie(unsigned.id);
		const notSigned = await request.get('/api/enrollment/nda', {
			headers: { Cookie: `dv_enrollment=${unsignedCookie.value}` },
		});
		expect(notSigned.status()).toBe(409);
		expect((await notSigned.json()).reason).toBe('not_signed');

		const signed = await seedEnrollment({
			email: uniqueEmail('nda-pdf-signed'),
			collectionStatus: 'paid',
			contractStatus: 'signed',
			accessStatus: 'active',
			externalRequestId: crypto.randomUUID(),
		});
		const signedCookie = await enrollmentCookie(signed.id);
		const pdf = await request.get('/api/enrollment/nda', {
			headers: { Cookie: `dv_enrollment=${signedCookie.value}` },
		});
		expect(pdf.status(), await pdf.text()).toBe(200);
		expect(pdf.headers()['content-type']).toBe('application/pdf');
		expect(pdf.headers()['content-disposition']).toContain('contrat-confidentialite.pdf');

		const adminAnon = await request.get(`/api/admin/enrollment/${signed.id}/nda`);
		expect(adminAnon.status()).toBe(401);

		const learnerHitsAdmin = await request.get(`/api/admin/enrollment/${signed.id}/nda`, {
			headers: { Cookie: `dv_enrollment=${unsignedCookie.value}` },
		});
		expect(learnerHitsAdmin.status()).toBe(401);
	});

	test('9. inscription signée — lien téléchargement NDA', async ({ page, context }) => {
		const signed = await seedEnrollment({
			email: uniqueEmail('nda-download-ui'),
			collectionStatus: 'paid',
			contractStatus: 'signed',
			accessStatus: 'active',
			externalRequestId: crypto.randomUUID(),
		});
		await context.addCookies([await enrollmentCookie(signed.id)]);
		await page.goto('/');
		await expect(page.locator('#access-tracking')).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Télécharger le contrat' }),
		).toBeVisible();
	});

	test('10. webhook DocuSeal sans / mauvaise signature → 400, valide → received', async ({
		request,
	}) => {
		const missing = await request.post('/api/webhooks/docuseal', {
			data: '{}',
			headers: { 'content-type': 'application/json' },
		});
		expect(missing.status()).toBe(400);

		const bad = await request.post('/api/webhooks/docuseal', {
			data: '{"event_type":"form.viewed"}',
			headers: {
				'content-type': 'application/json',
				'x-docuseal-signature': `${Math.floor(Date.now() / 1000)}.deadbeef`,
			},
		});
		expect(bad.status()).toBe(400);

		const { payload, signature } = signedDocusealPayload({
			event_type: 'form.viewed',
			timestamp: new Date().toISOString(),
		});
		const ok = await request.post('/api/webhooks/docuseal', {
			data: payload,
			headers: {
				'content-type': 'application/json',
				'x-docuseal-signature': signature,
			},
		});
		expect(ok.status(), await ok.text()).toBe(200);
		expect(await ok.json()).toMatchObject({ received: true });
	});

	test('11. admin login → GET /admin/inscriptions 200', async ({ request }) => {
		const { email, password } = adminCredentials();
		const login = await request.post('/api/admin/login', {
			data: { email, password },
		});
		expect(login.status(), await login.text()).toBe(200);

		const setCookie = login.headers()['set-cookie'] ?? '';
		const match = setCookie.match(/dv_admin=([^;]+)/);
		expect(match, 'cookie dv_admin manquant').toBeTruthy();

		const res = await request.get('/admin/inscriptions', {
			headers: { Cookie: `dv_admin=${match![1]}` },
		});
		expect(res.status(), await res.text()).toBe(200);
	});
});
