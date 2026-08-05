import type { Enrollment, Payment, Prisma, User } from '../../generated/prisma/client';
import { getPrisma } from '../prisma';
import { paginate, type Pagination } from '../pagination';
import {
	buildAdminPaymentSummary,
	listPaymentsForEnrollments,
	type AdminPaymentSummary,
} from './payments';
import { resolveNdaSignUrl } from '../services/enrollment';
import { stripeDashboardUrl } from '../stripe';
import { yousignAppUrl } from '../yousign';
import { adminPipelineBadges } from '../status';

export const ADMIN_PAGE_SIZE = 25;

export type AdminEnrollmentRow = Enrollment & {
	user: User;
	email: string;
	pipeline: ReturnType<typeof adminPipelineBadges>;
	paymentSummary: AdminPaymentSummary;
	stripeUrl: string | null;
	yousignUrl: string | null;
	signUrl: string | null;
	displayName: string;
};

export type AdminEnrollmentList = Pagination & {
	q: string;
	rows: AdminEnrollmentRow[];
};

/** Tokenized insensitive search on user email / firstName / lastName. */
export function enrollmentSearchWhere(q: string): Prisma.EnrollmentWhereInput | undefined {
	const tokens = q
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 5);

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

export function adminListHref(input: { q?: string; page?: number }): string {
	const params = new URLSearchParams();
	const q = input.q?.trim() ?? '';
	if (q) params.set('q', q);
	if (input.page && input.page > 1) params.set('page', String(input.page));
	const qs = params.toString();
	return qs ? `/admin?${qs}` : '/admin';
}

export async function toAdminEnrollmentRow(
	row: Enrollment & { user: User },
	payments: Payment[],
): Promise<AdminEnrollmentRow> {
	const paymentSummary = buildAdminPaymentSummary(row, payments);

	return {
		...row,
		email: row.user.email,
		pipeline: adminPipelineBadges({
			collectionStatus: row.collectionStatus,
			contractStatus: row.contractStatus,
			accessStatus: row.accessStatus,
			yousignStatus: row.yousignStatus,
		}),
		paymentSummary,
		stripeUrl: stripeDashboardUrl({
			paymentIntentId: row.stripePaymentIntentId,
			checkoutSessionId: row.stripeCheckoutSessionId,
			subscriptionId: row.stripeSubscriptionId,
			scheduleId: row.stripeScheduleId,
		}),
		yousignUrl: yousignAppUrl(row.yousignRequestId),
		signUrl: await resolveNdaSignUrl(row),
		displayName: `${row.user.firstName} ${row.user.lastName}`,
	};
}

/** Full export rows (admin CSV). Catalog query — not a keyed enrollment lookup. */
export async function listEnrollmentsForExport() {
	return getPrisma().enrollment.findMany({
		orderBy: { createdAt: 'desc' },
		include: {
			user: true,
			payments: { orderBy: { installmentNumber: 'asc' } },
		},
	});
}

export async function listAdminEnrollments(input: {
	q: string;
	page: number;
	pageSize?: number;
}): Promise<AdminEnrollmentList> {
	const q = input.q.trim();
	const where = enrollmentSearchWhere(q);
	const prisma = getPrisma();
	const total = await prisma.enrollment.count({ where });
	const pagination = paginate({
		total,
		page: input.page,
		pageSize: input.pageSize ?? ADMIN_PAGE_SIZE,
	});

	const enrollments = await prisma.enrollment.findMany({
		where,
		include: { user: true },
		orderBy: { createdAt: 'desc' },
		skip: pagination.skip,
		take: pagination.take,
	});

	const paymentsByEnrollment = await listPaymentsForEnrollments(enrollments.map((e) => e.id));

	return {
		...pagination,
		q,
		rows: await Promise.all(
			enrollments.map((row) =>
				toAdminEnrollmentRow(row, paymentsByEnrollment.get(row.id) ?? []),
			),
		),
	};
}
