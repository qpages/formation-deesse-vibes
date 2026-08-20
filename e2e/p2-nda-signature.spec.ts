import { expect, test } from '@playwright/test';
import {
	enrollmentCookie,
	findEnrollmentByEmail,
	seedEnrollment,
	uniqueEmail,
} from './helpers/seed';

const embedNda = (embedSrc: string) => ({
	provider: 'docuseal' as const,
	signKind: 'embed' as const,
	metadata: { embed_src: embedSrc },
});

test.describe('P2 NDA signature surfaces', () => {
	test('1. signé docuseal embed — pas d’embed, téléchargement + envoi copie', async ({
		page,
		context,
	}) => {
		const signed = await seedEnrollment({
			email: uniqueEmail('nda-signed-embed'),
			collectionStatus: 'paid',
			contractStatus: 'signed',
			accessStatus: 'active',
			nda: embedNda('https://docuseal.eu/s/e2e-signed-slug'),
		});
		await context.addCookies([await enrollmentCookie(signed.id)]);
		await page.goto('/');

		await expect(page.locator('#access-tracking')).toBeVisible();
		await expect(page.locator('#nda-docuseal-embed')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Télécharger le contrat' })).toBeVisible();
		await expect(page.locator('#nda-send-copy')).toBeVisible();
	});

	test('2. embed en attente — Actualiser visible', async ({ page, context }) => {
		const enrollment = await seedEnrollment({
			email: uniqueEmail('nda-await-embed'),
			collectionStatus: 'paid',
			contractStatus: 'sent',
			nda: embedNda('https://docuseal.eu/s/e2e-await-slug'),
		});
		await context.addCookies([await enrollmentCookie(enrollment.id)]);
		await page.goto('/');

		await expect(page.locator('#access-tracking')).toBeVisible();
		await expect(page.locator('#nda-docuseal-embed')).toBeVisible();
		await expect(page.locator('#nda-docuseal-refresh')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Actualiser' })).toBeVisible();
	});

	test('3. redirect — bouton J’ai signé visible', async ({ page, context }) => {
		const enrollment = await seedEnrollment({
			email: uniqueEmail('nda-redirect'),
			collectionStatus: 'paid',
			contractStatus: 'sent',
			nda: {
				provider: 'docuseal',
				signKind: 'redirect',
				externalRequestId: `e2e-redirect-${Date.now()}`,
				externalSignerId: 'sub-e2e-1',
			},
		});
		await context.addCookies([await enrollmentCookie(enrollment.id)]);
		await page.goto('/');

		await expect(page.locator('#access-tracking')).toBeVisible();
		await expect(page.locator('#nda-confirm-signed')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'J’ai signé le contrat de confidentialité' }),
		).toBeVisible();
		await expect(page.locator('#nda-docuseal-embed')).toHaveCount(0);
	});

	test('4. POST nda-sync — aligne le contrat signé en DB', async ({ request }) => {
		const email = uniqueEmail('nda-sync-api');
		const enrollment = await seedEnrollment({
			email,
			collectionStatus: 'paid',
			contractStatus: 'sent',
			nda: {
				provider: 'docuseal',
				signKind: 'embed',
				externalRequestId: `e2e-completed-${Date.now()}`,
			},
		});
		const cookie = await enrollmentCookie(enrollment.id);

		const res = await request.post('/api/enrollment/nda-sync', {
			headers: { Cookie: `dv_enrollment=${cookie.value}` },
		});
		expect(res.status(), await res.text()).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, signed: true });

		const updated = await findEnrollmentByEmail(email);
		expect(updated?.contractStatus).toBe('signed');
	});

	test('5. POST nda-send-copy — docuseal embed signé', async ({ request }) => {
		const enrollment = await seedEnrollment({
			email: uniqueEmail('nda-send-copy-api'),
			collectionStatus: 'paid',
			contractStatus: 'signed',
			accessStatus: 'active',
			nda: embedNda('https://docuseal.eu/s/e2e-copy-slug'),
		});
		const cookie = await enrollmentCookie(enrollment.id);

		const res = await request.post('/api/enrollment/nda-send-copy', {
			headers: { Cookie: `dv_enrollment=${cookie.value}` },
		});
		expect(res.status(), await res.text()).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true });
	});
});
