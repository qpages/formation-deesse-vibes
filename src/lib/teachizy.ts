import { z } from 'zod';
import { getEnv, requireEnv } from './env';

interface TeachizyInviteInput {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
}

const customFieldsSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

const teachizyTrainingSchema = z.object({
	training: z.object({
		uuid: z.string(),
		name: z.string(),
		created_at: z.string().optional(),
	}),
	enrolled_at: z.string().nullish(),
	started_at: z.string().nullish(),
	completed_at: z.string().nullish(),
	last_activity_at: z.string().nullish(),
	expiration: z.string().nullish(),
	blocked_at: z.string().nullish(),
	custom_fields: customFieldsSchema.optional(),
	total_duration_in_sec: z.coerce.number().default(0),
	training_items_count: z.coerce.number().default(0),
	training_items_completed_count: z.coerce.number().default(0),
	progression_percent: z.coerce.number().default(0),
	quiz_total_percent: z.coerce.number().default(-1),
});

export const teachizyCustomerSchema = z.object({
	uuid: z.string(),
	email: z.string(),
	firstname: z.string().nullish(),
	lastname: z.string().nullish(),
	created_at: z.string().optional(),
	last_login_at: z.string().nullish(),
	status: z.enum(['ACTIVE', 'DISABLED']).optional(),
	custom_fields: customFieldsSchema.optional(),
	trainings: z.array(teachizyTrainingSchema).default([]),
});

const exportMetaSchema = z.object({
	current_page: z.coerce.number(),
	from: z.coerce.number().nullable().optional(),
	to: z.coerce.number().nullable().optional(),
	last_page: z.coerce.number(),
	per_page: z.coerce.number(),
	total: z.coerce.number(),
	path: z.string().optional(),
});

const exportResponseSchema = z.object({
	data: z.array(z.unknown()),
	meta: exportMetaSchema,
});

const customerResponseSchema = z.object({
	data: teachizyCustomerSchema,
});

export type TeachizyCustomer = z.infer<typeof teachizyCustomerSchema>;
export type TeachizyTrainingEnrollment = z.infer<typeof teachizyTrainingSchema>;
export type TeachizyAccountStatus = 'ACTIVE' | 'DISABLED';

export type TeachizyExportQuery = {
	trainingUuid?: string;
	status?: TeachizyAccountStatus;
	page?: number;
	perPage?: number;
	begin?: string;
	end?: string;
};

export type TeachizyExportResult = {
	data: TeachizyCustomer[];
	meta: z.infer<typeof exportMetaSchema>;
};

export class TeachizyApiError extends Error {
	status: number;
	body: string;

	constructor(status: number, body: string) {
		super(`Teachizy API error ${status}: ${body}`);
		this.name = 'TeachizyApiError';
		this.status = status;
		this.body = body;
	}
}

function teachizyConfig() {
	const env = getEnv();
	const apiKey = env.TEACHIZY_API_KEY;
	const baseUrl = env.TEACHIZY_API_BASE.replace(/\/$/, '');
	return { apiKey, baseUrl, trainingUuid: env.TEACHIZY_TRAINING_UUID };
}

async function teachizyFetch(path: string, init?: RequestInit): Promise<Response> {
	const { apiKey, baseUrl } = teachizyConfig();
	if (!apiKey) {
		throw new TeachizyApiError(503, 'Missing TEACHIZY_API_KEY');
	}

	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(init?.headers ?? {}),
		},
	});
}

async function readErrorBody(response: Response): Promise<string> {
	return response.text();
}

/**
 * Invite un apprenant directement sur Teachizy via leur API REST.
 * @see https://developer.teachizy.fr/
 */
function isAlreadyEnrolled(customer: TeachizyCustomer, trainingUuid: string): boolean {
	const training = customer.trainings.find((row) => row.training.uuid === trainingUuid);
	return Boolean(training && !training.blocked_at && customer.status !== 'DISABLED');
}

export async function inviteToTeachizy(input: TeachizyInviteInput): Promise<void> {
	requireEnv('TEACHIZY_API_KEY');
	const trainingUuid = requireEnv('TEACHIZY_TRAINING_UUID');

	const existing = await getTeachizyCustomerByEmail(input.email);
	if (existing && isAlreadyEnrolled(existing, trainingUuid)) {
		console.log('[Teachizy] already enrolled — skip invite', {
			enrollmentId: input.enrollmentId,
			email: input.email,
			trainingUuid,
		});
		return;
	}

	console.log('[Teachizy] Sending invitation', {
		enrollmentId: input.enrollmentId,
		email: input.email,
		firstName: input.firstName,
		lastName: input.lastName,
		trainingUuid,
	});

	const response = await teachizyFetch('/externals/automations/customers', {
		method: 'POST',
		body: JSON.stringify({
			firstname: input.firstName,
			lastname: input.lastName,
			email: input.email,
			training_uuids: [trainingUuid],
		}),
	});

	if (!response.ok) {
		const body = await readErrorBody(response);
		console.error('[Teachizy] API error', {
			status: response.status,
			body,
			enrollmentId: input.enrollmentId,
		});
		throw new Error(`Teachizy API error ${response.status}: ${body}`, {
			cause: { enrollmentId: input.enrollmentId },
		});
	}

	console.log('[Teachizy] Invitation sent successfully', {
		enrollmentId: input.enrollmentId,
		status: response.status,
	});
}

export async function exportTeachizyCustomers(
	query: TeachizyExportQuery = {},
): Promise<TeachizyExportResult> {
	const params = new URLSearchParams();
	if (query.trainingUuid) params.set('training_uuid', query.trainingUuid);
	if (query.status) params.set('status', query.status);
	if (query.page && query.page > 1) params.set('page', String(query.page));
	if (query.perPage) params.set('per_page', String(query.perPage));
	if (query.begin) params.set('begin', query.begin);
	if (query.end) params.set('end', query.end);

	const qs = params.toString();
	const path = `/externals/automations/customers/export${qs ? `?${qs}` : ''}`;
	const response = await teachizyFetch(path);

	if (!response.ok) {
		throw new TeachizyApiError(response.status, await readErrorBody(response));
	}

	const parsed = exportResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new TeachizyApiError(502, 'Réponse Teachizy inattendue');
	}

	const data: TeachizyCustomer[] = [];
	for (const item of parsed.data.data) {
		const customer = teachizyCustomerSchema.safeParse(item);
		if (customer.success) data.push(customer.data);
		else console.warn('[Teachizy] skipped invalid customer', customer.error.issues);
	}

	return { data, meta: parsed.data.meta };
}

export async function getTeachizyCustomerByEmail(email: string): Promise<TeachizyCustomer | null> {
	const params = new URLSearchParams({ email });
	const response = await teachizyFetch(`/externals/automations/customers?${params.toString()}`);

	if (response.status === 404) return null;
	if (!response.ok) {
		throw new TeachizyApiError(response.status, await readErrorBody(response));
	}

	const parsed = customerResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new TeachizyApiError(502, 'Réponse Teachizy inattendue');
	}

	return parsed.data.data;
}

export function isTeachizyConfigured(): boolean {
	return Boolean(teachizyConfig().apiKey);
}
