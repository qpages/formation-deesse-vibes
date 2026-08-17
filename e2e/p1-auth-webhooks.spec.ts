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

test.describe('P1 magic link, admin, IDOR, webhooks', () => {
	test('5. magic link unused → cookie + /?connected=1', async ({ page, context }) => {
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

	test('6. même lien utilisé, autre navigateur → /?link=invalid', async ({ browser }) => {
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

	test('7. magic-link/request connu et inconnu → même JSON 200', async ({ request }) => {
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

	test('8. /admin sans session → 302 login', async ({ request }) => {
		const res = await request.get('/admin/inscriptions', { maxRedirects: 0 });
		expect([302, 303, 401]).toContain(res.status());
		if (res.status() !== 401) {
			expect(res.headers().location ?? '').toMatch(/\/admin\/login/);
		}
	});

	test('9. nda/resend IDOR → 403', async ({ request }) => {
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

	test('10. webhook Stripe sans / mauvaise signature → 400', async ({ request }) => {
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

	test('11. même événement Stripe deux fois → duplicate: true', async ({ request }) => {
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

	test('12. nda-sync sans session → 401 ; déjà signé → signed true', async ({ request }) => {
		const anonymous = await request.post('/api/enrollment/nda-sync');
		expect(anonymous.status()).toBe(401);

		const enrollment = await seedEnrollment({
			email: uniqueEmail('ndasync'),
			collectionStatus: 'paid',
			contractStatus: 'signed',
			accessStatus: 'active',
		});
		const cookie = await enrollmentCookie(enrollment.id);
		const res = await request.post('/api/enrollment/nda-sync', {
			headers: { Cookie: `dv_enrollment=${cookie.value}` },
		});
		expect(res.status(), await res.text()).toBe(200);
		expect(await res.json()).toEqual({ ok: true, signed: true });
	});
});
