import { expect, test } from '@playwright/test';
import {
	checkoutBody,
	enrollmentCookie,
	findEnrollmentByEmail,
	seedEnrollment,
	uniqueEmail,
} from './helpers/seed';

test.describe('P0 checkout + home', () => {
	test('1. checkout nouveau → 200 JSON { url }, pas 500', async ({ request }) => {
		const email = uniqueEmail('checkout');
		const res = await request.post('/api/checkout', { data: checkoutBody(email) });
		expect(res.status(), await res.text()).not.toBe(500);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
	});

	test('2. retour succès → cookie dv_enrollment + suivi', async ({ page, context }) => {
		const email = uniqueEmail('success');
		const sessionId = `cs_test_e2e_success_${Date.now()}`;
		await seedEnrollment({
			email,
			collectionStatus: 'paid',
			contractStatus: 'pending',
			stripeCheckoutSessionId: sessionId,
		});

		const res = await page.goto(`/?checkout=success&session_id=${sessionId}`);
		expect(res?.ok()).toBeTruthy();

		const cookies = await context.cookies();
		expect(cookies.some((c) => c.name === 'dv_enrollment' && c.value)).toBeTruthy();

		await expect(page.locator('#access-tracking')).toBeVisible();
		await expect(page.locator('#status-panel')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Votre inscription' })).toBeVisible();
		await expect(
			page.getByText('Votre paiement est bien confirmé', { exact: false }),
		).toBeVisible();
	});

	test('3. déjà inscrit → 409', async ({ request }) => {
		const email = uniqueEmail('dup');
		await seedEnrollment({
			email,
			collectionStatus: 'paid',
			contractStatus: 'signed',
			accessStatus: 'active',
		});

		const res = await request.post('/api/checkout', { data: checkoutBody(email) });
		expect(res.status()).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/déjà inscrit/i);
	});

	test('4. home sans cookie → funnel ; avec cookie → suivi', async ({ page, context }) => {
		const guest = await page.goto('/');
		expect(guest?.ok()).toBeTruthy();
		await expect(page.locator('#access-funnel')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Démarrer ma formation' })).toBeVisible();
		await expect(page.locator('#checkout-form')).toBeVisible();

		const email = uniqueEmail('home');
		const enrollment = await seedEnrollment({
			email,
			collectionStatus: 'current',
			contractStatus: 'sent',
		});
		await context.addCookies([await enrollmentCookie(enrollment.id)]);

		await page.goto('/');
		await expect(page.locator('#access-tracking')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Votre inscription' })).toBeVisible();
		await expect(page.locator('#access-funnel')).toHaveCount(0);
		await expect(page.locator('#status-panel')).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Télécharger le contrat' }),
		).toHaveCount(0);
	});

	test('5. checkout sans renonciation rétractation → 400', async ({ request }) => {
		const email = uniqueEmail('no-waiver');
		const res = await request.post('/api/checkout', {
			data: { ...checkoutBody(email), consentWithdrawalWaiver: false },
		});
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/rétractation/i);
	});

	test('6. checkout avec renonciation → consentWithdrawalWaiverAt persisté', async ({
		request,
	}) => {
		const email = uniqueEmail('waiver');
		const res = await request.post('/api/checkout', { data: checkoutBody(email) });
		expect(res.status(), await res.text()).toBe(200);

		const enrollment = await findEnrollmentByEmail(email);
		expect(enrollment).not.toBeNull();
		expect(enrollment!.consentWithdrawalWaiverAt).not.toBeNull();
		expect(enrollment!.consentCgvAt).not.toBeNull();
		expect(enrollment!.consentNdaAt).not.toBeNull();
		expect(enrollment!.consentPrivacyAt).not.toBeNull();
	});
});
