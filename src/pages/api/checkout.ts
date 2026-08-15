import type { APIRoute } from 'astro';
import { createPendingEnrollment, DuplicateEnrollmentError } from '../../lib/services/enrollment';
import { CheckoutAlreadyPaidError, startCheckout } from '../../lib/services/payments';
import { getEnv } from '../../lib/env';
import { json } from '../../lib/http';
import { RATE_LIMITS, clientIp, enforceRateLimit, rateLimitKey } from '../../lib/rate-limit';
import { checkoutSchema } from '../../lib/validation';

export const POST: APIRoute = async ({ request, clientAddress }) => {
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

		const limited = enforceRateLimit(
			rateLimitKey(RATE_LIMITS.checkout, [clientIp(request, clientAddress), parsed.data.email]),
			RATE_LIMITS.checkout,
		);
		if (limited) return limited;

		const enrollment = await createPendingEnrollment(parsed.data);
		const site = getEnv().PUBLIC_SITE_URL;

		const { url } = await startCheckout({
			enrollment,
			paymentPlan: parsed.data.paymentPlan,
			successUrl: `${site}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${site}/?checkout=cancel`,
		});

		return json({ url });
	} catch (error) {
		if (error instanceof DuplicateEnrollmentError || error instanceof CheckoutAlreadyPaidError) {
			return json(
				{
					error: 'Cet e-mail est déjà inscrit. Utilisez l’onglet « Déjà inscrit·e ».',
				},
				409,
			);
		}
		console.error('[checkout]', error);
		return json({ error: 'Erreur lors de la création du paiement.' }, 500);
	}
};
