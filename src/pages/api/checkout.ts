import type { APIRoute } from 'astro';
import {
	createPendingEnrollment,
	DuplicateEnrollmentError,
} from '../../lib/services/enrollment';
import { createCheckoutSession } from '../../lib/services/stripe';
import { getEnv } from '../../lib/env';
import { checkoutSchema } from '../../lib/validation';
import { getPrisma } from '../../lib/db';

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const parsed = checkoutSchema.safeParse({
			...body,
			consentCgv: body.consentCgv === true || body.consentCgv === 'true',
			consentNda: body.consentNda === true || body.consentNda === 'true',
			consentPrivacy: body.consentPrivacy === true || body.consentPrivacy === 'true',
		});

		if (!parsed.success) {
			return json({ error: parsed.error.issues[0]?.message ?? 'Données invalides' }, 400);
		}

		const enrollment = await createPendingEnrollment(parsed.data);
		const site = getEnv().PUBLIC_SITE_URL;

		const session = await createCheckoutSession({
			enrollmentId: enrollment.id,
			email: enrollment.email,
			firstName: enrollment.firstName,
			lastName: enrollment.lastName,
			successUrl: `${site}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${site}/?checkout=cancel`,
		});

		await getPrisma().enrollment.update({
			where: { id: enrollment.id },
			data: { stripeCheckoutSessionId: session.id },
		});

		if (!session.url) {
			return json({ error: 'Impossible de créer la session de paiement.' }, 500);
		}

		return json({ url: session.url });
	} catch (error) {
		if (error instanceof DuplicateEnrollmentError) {
			return json(
				{
					error:
						'Cet e-mail est déjà inscrit. Utilisez « Retrouver mon inscription » ci-dessous.',
				},
				409,
			);
		}
		console.error('[checkout]', error);
		return json({ error: 'Erreur lors de la création du paiement.' }, 500);
	}
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
