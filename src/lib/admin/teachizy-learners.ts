import { getPrisma } from '../prisma';
import { getEnv } from '../env';
import { paginate } from '../pagination';
import {
	exportTeachizyCustomers,
	getTeachizyCustomerByEmail,
	isTeachizyConfigured,
	TeachizyApiError,
	type TeachizyAccountStatus,
	type TeachizyCustomer,
	type TeachizyTrainingEnrollment,
} from '../teachizy';

export const LEARNERS_PAGE_SIZE = 25;

export type LearnerTrainingStatus =
	| 'not_started'
	| 'in_progress'
	| 'completed'
	| 'blocked'
	| 'expired';

export type AdminLearnerRow = {
	uuid: string;
	email: string;
	displayName: string;
	accountStatus: TeachizyAccountStatus | null;
	trainingStatus: LearnerTrainingStatus | null;
	progressionPercent: number;
	itemsCompleted: number;
	itemsTotal: number;
	durationSeconds: number;
	lastActivityAt: Date | null;
	lastLoginAt: Date | null;
	enrollmentId: string | null;
};

export type AdminLearnerDetail = AdminLearnerRow & {
	trainingName: string | null;
	quizPercent: number | null;
	enrolledAt: Date | null;
	startedAt: Date | null;
	completedAt: Date | null;
	blockedAt: Date | null;
	expirationAt: Date | null;
};

export type AdminTeachizyLearnerResult = {
	configured: boolean;
	error: string | null;
	learner: AdminLearnerDetail | null;
};

export type AdminLearnerList = {
	q: string;
	status: TeachizyAccountStatus | '';
	rows: AdminLearnerRow[];
	error: string | null;
	configured: boolean;
	total: number;
	page: number;
	totalPages: number;
	from: number;
	to: number;
	hasPrev: boolean;
	hasNext: boolean;
};

const STATUS_LABELS: Record<LearnerTrainingStatus, string> = {
	not_started: 'Pas commencé',
	in_progress: 'En cours',
	completed: 'Terminé',
	blocked: 'Bloqué',
	expired: 'Expiré',
};

const STATUS_TONES: Record<LearnerTrainingStatus, 'neutral' | 'progress' | 'success' | 'action'> =
	{
		not_started: 'neutral',
		in_progress: 'progress',
		completed: 'success',
		blocked: 'action',
		expired: 'action',
	};

export function learnerStatusLabel(status: LearnerTrainingStatus | null): string {
	if (!status) return '—';
	return STATUS_LABELS[status];
}

export function learnerStatusTone(
	status: LearnerTrainingStatus | null,
): 'neutral' | 'progress' | 'success' | 'action' {
	if (!status) return 'neutral';
	return STATUS_TONES[status];
}

export function adminLearnersHref(input: {
	q?: string;
	page?: number;
	status?: string;
}): string {
	const params = new URLSearchParams();
	const q = input.q?.trim() ?? '';
	if (q) params.set('q', q);
	if (input.status) params.set('status', input.status);
	if (input.page && input.page > 1) params.set('page', String(input.page));
	const qs = params.toString();
	return qs ? `/admin/apprenants?${qs}` : '/admin/apprenants';
}

export function pickTraining(
	customer: TeachizyCustomer,
	trainingUuid?: string,
): TeachizyTrainingEnrollment | null {
	if (trainingUuid) {
		return customer.trainings.find((row) => row.training.uuid === trainingUuid) ?? null;
	}
	return customer.trainings[0] ?? null;
}

export function deriveTrainingStatus(
	training: TeachizyTrainingEnrollment | null,
	now = new Date(),
): LearnerTrainingStatus | null {
	if (!training) return null;
	if (training.blocked_at) return 'blocked';
	if (training.expiration) {
		const expiration = parseTeachizyDate(training.expiration);
		if (expiration && expiration.getTime() < now.getTime()) return 'expired';
	}
	if (training.completed_at) return 'completed';
	if (training.started_at) return 'in_progress';
	return 'not_started';
}

export function parseTeachizyDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLearnerDate(value: Date | null): string {
	if (!value) return '—';
	return value.toLocaleString('fr-FR', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	});
}

export function formatLearnerDuration(seconds: number): string {
	if (!seconds || seconds < 0) return '—';
	if (seconds < 60) return '< 1 min';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `${hours} h ${rest}` : `${hours} h`;
}

function displayName(customer: TeachizyCustomer): string {
	const name = [customer.firstname, customer.lastname]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(' ');
	return name || customer.email;
}

function customerMatchesQuery(customer: TeachizyCustomer, q: string): boolean {
	const tokens = q
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 5);
	if (tokens.length === 0) return true;

	const haystack = [customer.email, customer.firstname, customer.lastname]
		.map((part) => part?.toLowerCase() ?? '')
		.join(' ');

	return tokens.every((token) => haystack.includes(token.toLowerCase()));
}

function toRow(
	customer: TeachizyCustomer,
	trainingUuid: string | undefined,
	enrollmentId: string | null,
): AdminLearnerRow {
	const detail = toDetail(customer, trainingUuid, enrollmentId);
	return {
		uuid: detail.uuid,
		email: detail.email,
		displayName: detail.displayName,
		accountStatus: detail.accountStatus,
		trainingStatus: detail.trainingStatus,
		progressionPercent: detail.progressionPercent,
		itemsCompleted: detail.itemsCompleted,
		itemsTotal: detail.itemsTotal,
		durationSeconds: detail.durationSeconds,
		lastActivityAt: detail.lastActivityAt,
		lastLoginAt: detail.lastLoginAt,
		enrollmentId: detail.enrollmentId,
	};
}

function toDetail(
	customer: TeachizyCustomer,
	trainingUuid: string | undefined,
	enrollmentId: string | null,
): AdminLearnerDetail {
	const training = pickTraining(customer, trainingUuid);
	const quiz =
		training && training.quiz_total_percent >= 0 ? training.quiz_total_percent : null;

	return {
		uuid: customer.uuid,
		email: customer.email,
		displayName: displayName(customer),
		accountStatus: customer.status ?? null,
		trainingStatus: deriveTrainingStatus(training),
		progressionPercent: training ? Math.max(0, Math.round(training.progression_percent)) : 0,
		itemsCompleted: training?.training_items_completed_count ?? 0,
		itemsTotal: training?.training_items_count ?? 0,
		durationSeconds: training?.total_duration_in_sec ?? 0,
		lastActivityAt: parseTeachizyDate(training?.last_activity_at),
		lastLoginAt: parseTeachizyDate(customer.last_login_at),
		enrollmentId,
		trainingName: training?.training.name ?? null,
		quizPercent: quiz,
		enrolledAt: parseTeachizyDate(training?.enrolled_at),
		startedAt: parseTeachizyDate(training?.started_at),
		completedAt: parseTeachizyDate(training?.completed_at),
		blockedAt: parseTeachizyDate(training?.blocked_at),
		expirationAt: parseTeachizyDate(training?.expiration),
	};
}

async function enrollmentIdsByEmail(emails: string[]): Promise<Map<string, string>> {
	if (emails.length === 0) return new Map();

	const uniqueEmails = [...new Set(emails.map((email) => email.toLowerCase()))];
	const users = await getPrisma().user.findMany({
		where: {
			OR: uniqueEmails.map((email) => ({
				email: { equals: email, mode: 'insensitive' },
			})),
		},
		select: {
			email: true,
			enrollments: {
				select: { id: true },
				orderBy: { createdAt: 'desc' },
				take: 1,
			},
		},
	});

	const map = new Map<string, string>();
	for (const user of users) {
		const id = user.enrollments[0]?.id;
		if (id) map.set(user.email.toLowerCase(), id);
	}
	return map;
}

function emptyList(
	filters: { q: string; status: TeachizyAccountStatus | ''; page: number },
	error: string | null,
	configured: boolean,
): AdminLearnerList {
	const pagination = paginate({ total: 0, page: 1, pageSize: LEARNERS_PAGE_SIZE });
	return {
		...filters,
		rows: [],
		error,
		configured,
		total: pagination.total,
		page: pagination.page,
		totalPages: pagination.totalPages,
		from: pagination.from,
		to: pagination.to,
		hasPrev: pagination.hasPrev,
		hasNext: pagination.hasNext,
	};
}

function teachizyErrorMessage(error: unknown): string {
	if (error instanceof TeachizyApiError) {
		if (error.status === 503) return 'Teachizy n’est pas configuré (TEACHIZY_API_KEY).';
		if (error.status === 422) return 'Filtre Teachizy invalide.';
		if (error.status === 401 || error.status === 403) {
			return 'Clé API Teachizy refusée.';
		}
		return `Teachizy a renvoyé une erreur (${error.status}).`;
	}
	return 'Impossible de charger les apprenants Teachizy.';
}

export async function getAdminTeachizyLearner(
	email: string,
	enrollmentId?: string,
): Promise<AdminTeachizyLearnerResult> {
	if (!isTeachizyConfigured()) {
		return { configured: false, error: null, learner: null };
	}

	try {
		const customer = await getTeachizyCustomerByEmail(email);
		if (!customer) {
			return { configured: true, error: null, learner: null };
		}

		return {
			configured: true,
			error: null,
			learner: toDetail(customer, getEnv().TEACHIZY_TRAINING_UUID, enrollmentId ?? null),
		};
	} catch (error) {
		console.error('[Teachizy] load learner failed', error);
		return { configured: true, error: teachizyErrorMessage(error), learner: null };
	}
}

export async function listAdminTeachizyLearners(filters: {
	q: string;
	page: number;
	status: TeachizyAccountStatus | '';
}): Promise<AdminLearnerList> {
	if (!isTeachizyConfigured()) {
		return emptyList(filters, 'Teachizy n’est pas configuré (TEACHIZY_API_KEY).', false);
	}

	const trainingUuid = getEnv().TEACHIZY_TRAINING_UUID;
	const q = filters.q.trim();
	const emailQuery = q.includes('@') ? q.toLowerCase() : '';

	try {
		if (emailQuery) {
			const customer = await getTeachizyCustomerByEmail(emailQuery);
			if (!customer) {
				return emptyList({ ...filters, page: 1 }, null, true);
			}

			if (filters.status && customer.status && customer.status !== filters.status) {
				return emptyList({ ...filters, page: 1 }, null, true);
			}

			if (trainingUuid && !pickTraining(customer, trainingUuid)) {
				return emptyList({ ...filters, page: 1 }, null, true);
			}

			const ids = await enrollmentIdsByEmail([customer.email]);
			const row = toRow(
				customer,
				trainingUuid,
				ids.get(customer.email.toLowerCase()) ?? null,
			);
			return {
				...filters,
				page: 1,
				rows: [row],
				error: null,
				configured: true,
				total: 1,
				totalPages: 1,
				from: 1,
				to: 1,
				hasPrev: false,
				hasNext: false,
			};
		}

		const result = await exportTeachizyCustomers({
			trainingUuid,
			status: filters.status || undefined,
			page: q ? 1 : filters.page,
			perPage: q ? 1000 : LEARNERS_PAGE_SIZE,
		});

		const customers = q
			? result.data.filter((customer) => customerMatchesQuery(customer, q))
			: result.data;

		const ids = await enrollmentIdsByEmail(customers.map((row) => row.email));
		const rows = customers.map((customer) =>
			toRow(customer, trainingUuid, ids.get(customer.email.toLowerCase()) ?? null),
		);

		if (q) {
			const total = rows.length;
			return {
				...filters,
				page: 1,
				rows,
				error: null,
				configured: true,
				total,
				totalPages: 1,
				from: total === 0 ? 0 : 1,
				to: total,
				hasPrev: false,
				hasNext: false,
			};
		}

		const total = result.meta.total;
		const page = result.meta.current_page;
		const pageSize = result.meta.per_page || LEARNERS_PAGE_SIZE;
		const totalPages = Math.max(1, result.meta.last_page);
		const from = result.meta.from ?? (total === 0 ? 0 : (page - 1) * pageSize + 1);
		const to = result.meta.to ?? Math.min(page * pageSize, total);

		return {
			...filters,
			rows,
			error: null,
			configured: true,
			total,
			page,
			totalPages,
			from,
			to,
			hasPrev: page > 1,
			hasNext: page < totalPages,
		};
	} catch (error) {
		console.error('[Teachizy] export learners failed', error);
		return emptyList(filters, teachizyErrorMessage(error), true);
	}
}
