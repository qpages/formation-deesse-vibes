import { z } from 'zod';
import {
	ACCESS_FILTER_VALUES,
	adminActionKeySchema,
	COLLECTION_FILTER_VALUES,
	CONTRACT_FILTER_VALUES,
} from './admin/actions';
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
	consentWithdrawalWaiver: z.literal(true, {
		error: 'Renonciation au droit de rétractation requise pour l’accès immédiat',
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
const collectionFilterSchema = z.enum(COLLECTION_FILTER_VALUES);
const contractFilterSchema = z.enum(CONTRACT_FILTER_VALUES);
const accessFilterSchema = z.enum(ACCESS_FILTER_VALUES);

export function parseAdminListQuery(params: URLSearchParams) {
	const q = adminSearchQuerySchema.safeParse(params.get('q') ?? '');
	const page = adminPageSchema.safeParse(params.get('page') ?? 1);
	const collection = collectionFilterSchema.safeParse(params.get('collection') ?? '');
	const contract = contractFilterSchema.safeParse(params.get('contract') ?? '');
	const access = accessFilterSchema.safeParse(params.get('access') ?? '');

	return {
		q: q.success ? q.data : '',
		page: page.success ? page.data : 1,
		collection: collection.success ? collection.data : ('' as const),
		contract: contract.success ? contract.data : ('' as const),
		access: access.success ? access.data : ('' as const),
	};
}

const learnerSearchQuerySchema = z.string().trim().max(254);
const learnerStatusSchema = z.enum(['ACTIVE', 'DISABLED']);

export function parseAdminLearnersQuery(params: URLSearchParams) {
	const q = learnerSearchQuerySchema.safeParse(params.get('q') ?? '');
	const page = adminPageSchema.safeParse(params.get('page') ?? 1);
	const status = learnerStatusSchema.safeParse(params.get('status') ?? '');

	return {
		q: q.success ? q.data : '',
		page: page.success ? page.data : 1,
		status: status.success ? status.data : ('' as const),
	};
}
