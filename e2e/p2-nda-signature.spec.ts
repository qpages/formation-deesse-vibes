import { expect, test } from '@playwright/test';
import {
	enrollmentCookie,
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

	test('2. POST nda-send-copy — docuseal embed signé', async ({ request }) => {
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
