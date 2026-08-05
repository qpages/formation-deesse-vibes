import { z } from 'zod';
import { adminActionKeySchema } from './admin/actions';
import { paymentPlanIdSchema } from './payment-plans';

export const checkoutSchema = z.object({
	firstName: z.string().trim().min(1, 'Prénom requis').max(80),
	lastName: z.string().trim().min(1, 'Nom requis').max(80),
	email: z.string().trim().email('E-mail invalide').max(254),
	paymentPlan: paymentPlanIdSchema,
	consentCgv: z.literal(true, { error: 'Acceptation des CGV requise' }),
	consentNda: z.literal(true, { error: 'Acceptation du NDA requise' }),
	consentPrivacy: z.literal(true, {
		error: 'Acceptation de la politique de confidentialité requise',
	}),
});

export const magicLinkSchema = z.object({
	email: z.string().trim().email('E-mail invalide').max(254),
});

export const adminLoginSchema = z.object({
	email: z.string().trim().email(),
	password: z.string().min(8),
});

export const adminActionSchema = z.object({
	enrollmentId: z.string().min(1),
	action: adminActionKeySchema,
});

const adminSearchQuerySchema = z.string().trim().max(100);
const adminPageSchema = z.coerce.number().int().min(1).max(10_000);

export function parseAdminListQuery(params: URLSearchParams) {
	const q = adminSearchQuerySchema.safeParse(params.get('q') ?? '');
	const page = adminPageSchema.safeParse(params.get('page') ?? 1);
	return {
		q: q.success ? q.data : '',
		page: page.success ? page.data : 1,
	};
}
