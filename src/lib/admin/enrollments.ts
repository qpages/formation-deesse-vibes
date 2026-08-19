import type {
	AccessStatus,
	AdminAction,
	CollectionStatus,
	ContractStatus,
	Enrollment,
	NdaRequest,
	Payment,
	Prisma,
	User,
} from '../../generated/prisma/client';
import { getPrisma } from '../prisma';
import { paginate, type Pagination } from '../pagination';
import { stripeDashboardUrl } from '../stripe';
import { yousignAppUrl } from '../signature/helpers';
import {
	resolveExternalRequestId,
	resolveExternalSignerId,
} from '../signature/nda-request';
import { adminPipelineBadges } from '../status';
import { adminActionLabel } from './action-labels';
import { visibleActions, type AdminActionKey } from './actions';
import {
	buildAdminPaymentSummary,
	listPaymentsForEnrollments,
	type AdminPaymentSummary,
} from './payments';

export const ADMIN_PAGE_SIZE = 25;

export type AdminListFilters = {
	q: string;
	page: number;
	pageSize?: number;
	collection?: CollectionStatus | '';
	contract?: ContractStatus | '';
	access?: AccessStatus | '';
};

export type AdminEnrollmentRow = Enrollment & {
	user: User;
	email: string;
	externalRequestId: string | null;
	externalSignerId: string | null;
	pipeline: ReturnType<typeof adminPipelineBadges>;
	paymentSummary: AdminPaymentSummary;
	stripeUrl: string | null;
	yousignUrl: string | null;
	displayName: string;
	visibleActions: AdminActionKey[];
};

export type AdminEnrollmentList = Pagination & {
	q: string;
	collection: CollectionStatus | '';
	contract: ContractStatus | '';
	access: AccessStatus | '';
	rows: AdminEnrollmentRow[];
};

export type AdminEnrollmentDetail = AdminEnrollmentRow & {
	audit: Array<{
		id: string;
		action: string;
		actionLabel: string;
		adminEmail: string;
		createdAt: Date;
	}>;
};

/** Tokenized insensitive search on user email / firstName / lastName. */
export function enrollmentSearchWhere(q: string): Prisma.EnrollmentWhereInput | undefined {
	const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);

	if (tokens.length === 0) return undefined;

	return {
		AND: tokens.map((token) => ({
			OR: [
				{ user: { email: { contains: token, mode: 'insensitive' } } },
				{ user: { firstName: { contains: token, mode: 'insensitive' } } },
				{ user: { lastName: { contains: token, mode: 'insensitive' } } },
			],
		})),
	};
}

export function adminEnrollmentWhere(
	input: AdminListFilters,
): Prisma.EnrollmentWhereInput | undefined {
	const parts: Prisma.EnrollmentWhereInput[] = [];

	const search = enrollmentSearchWhere(input.q);
	if (search) parts.push(search);

	if (input.collection) parts.push({ collectionStatus: input.collection });
	if (input.contract) parts.push({ contractStatus: input.contract });
	if (input.access) parts.push({ accessStatus: input.access });

	if (parts.length === 0) return undefined;
	if (parts.length === 1) return parts[0];
	return { AND: parts };
}

export function adminListHref(input: {
	q?: string;
	page?: number;
	collection?: string;
	contract?: string;
	access?: string;
}): string {
	const params = new URLSearchParams();
	const q = input.q?.trim() ?? '';
	if (q) params.set('q', q);
	if (input.collection) params.set('collection', input.collection);
	if (input.contract) params.set('contract', input.contract);
	if (input.access) params.set('access', input.access);
	if (input.page && input.page > 1) params.set('page', String(input.page));
	const qs = params.toString();
	return qs ? `/admin/inscriptions?${qs}` : '/admin/inscriptions';
}

export function toAdminEnrollmentRow(
	row: Enrollment & { user: User; ndaRequest?: NdaRequest | null },
	payments: Payment[],
): AdminEnrollmentRow {
	const paymentSummary = buildAdminPaymentSummary(row, payments);
	const externalRequestId = resolveExternalRequestId(row);
	const externalSignerId = resolveExternalSignerId(row);

	return {
		...row,
		email: row.user.email,
		externalRequestId,
		externalSignerId,
		pipeline: adminPipelineBadges({
			collectionStatus: row.collectionStatus,
			contractStatus: row.contractStatus,
			accessStatus: row.accessStatus,
			yousignStatus: row.yousignStatus,
			yousignLastError: row.yousignLastError,
		}),
		paymentSummary,
		stripeUrl: stripeDashboardUrl({
			paymentIntentId: row.stripePaymentIntentId,
			checkoutSessionId: row.stripeCheckoutSessionId,
			subscriptionId: row.stripeSubscriptionId,
			scheduleId: row.stripeScheduleId,
		}),
		yousignUrl: yousignAppUrl(externalRequestId),
		displayName: `${row.user.firstName} ${row.user.lastName}`,
		visibleActions: visibleActions(row),
	};
}

/** Full export rows (admin CSV). Catalog query — not a keyed enrollment lookup. */
export async function listEnrollmentsForExport() {
	return getPrisma().enrollment.findMany({
		orderBy: { createdAt: 'desc' },
		include: {
			user: true,
			ndaRequest: true,
			payments: { orderBy: { installmentNumber: 'asc' } },
		},
	});
}

export async function listAdminEnrollments(input: AdminListFilters): Promise<AdminEnrollmentList> {
	const q = input.q.trim();
	const collection = input.collection ?? '';
	const contract = input.contract ?? '';
	const access = input.access ?? '';
	const where = adminEnrollmentWhere({
		q,
		page: input.page,
		collection,
		contract,
		access,
	});
	const prisma = getPrisma();
	const total = await prisma.enrollment.count({ where });
	const pagination = paginate({
		total,
		page: input.page,
		pageSize: input.pageSize ?? ADMIN_PAGE_SIZE,
	});

	const enrollments = await prisma.enrollment.findMany({
		where,
		include: { user: true, ndaRequest: true },
		orderBy: { createdAt: 'desc' },
		skip: pagination.skip,
		take: pagination.take,
	});

	const paymentsByEnrollment = await listPaymentsForEnrollments(enrollments.map((e) => e.id));

	return {
		...pagination,
		q,
		collection,
		contract,
		access,
		rows: enrollments.map((row) =>
			toAdminEnrollmentRow(row, paymentsByEnrollment.get(row.id) ?? []),
		),
	};
}

export async function getAdminEnrollmentDetail(id: string): Promise<AdminEnrollmentDetail | null> {
	const prisma = getPrisma();
	const enrollment = await prisma.enrollment.findUnique({
		where: { id },
		include: {
			user: true,
			ndaRequest: true,
			payments: { orderBy: { installmentNumber: 'asc' } },
			adminActions: { orderBy: { createdAt: 'desc' }, take: 50 },
		},
	});
	if (!enrollment) return null;

	const { adminActions, payments, ...rest } = enrollment;
	const row = toAdminEnrollmentRow(rest, payments);

	return {
		...row,
		audit: adminActions.map((a: AdminAction) => ({
			id: a.id,
			action: a.action,
			actionLabel: adminActionLabel(a.action),
			adminEmail: a.adminEmail,
			createdAt: a.createdAt,
		})),
	};
}
