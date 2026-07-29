import type { APIRoute } from 'astro';
import {
	ADMIN_COOKIE,
	parseCookie,
	verifyAdminSessionToken,
} from '../../../lib/auth/session';
import { getPrisma } from '../../../lib/db';
import { STATUS_LABELS } from '../../../lib/status';

export const GET: APIRoute = async ({ request }) => {
	const adminEmail = await verifyAdminSessionToken(
		parseCookie(request.headers.get('cookie'), ADMIN_COOKIE) ?? '',
	);
	if (!adminEmail) {
		return new Response('Unauthorized', { status: 401 });
	}

	const rows = await getPrisma().enrollment.findMany({
		orderBy: { createdAt: 'desc' },
	});

	const header = [
		'id',
		'email',
		'firstName',
		'lastName',
		'status',
		'statusLabel',
		'yousignStatus',
		'amountCents',
		'stripeCheckoutSessionId',
		'yousignRequestId',
		'createdAt',
		'updatedAt',
	];

	const lines = [
		header.join(','),
		...rows.map((r) =>
			[
				r.id,
				r.email,
				csv(r.firstName),
				csv(r.lastName),
				r.status,
				csv(STATUS_LABELS[r.status]),
				r.yousignStatus ?? '',
				r.amountCents,
				r.stripeCheckoutSessionId ?? '',
				r.yousignRequestId ?? '',
				r.createdAt.toISOString(),
				r.updatedAt.toISOString(),
			].join(','),
		),
	];

	return new Response(lines.join('\n'), {
		status: 200,
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': 'attachment; filename="enrollments.csv"',
		},
	});
};

function csv(value: string) {
	if (/[",\n]/.test(value)) {
		return `"${value.replaceAll('"', '""')}"`;
	}
	return value;
}
