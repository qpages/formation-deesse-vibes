import type { APIRoute } from 'astro';
import {
	ADMIN_COOKIE,
	parseCookie,
	verifyAdminSessionToken,
} from '../../../lib/auth/session';
import { getPrisma } from '../../../lib/db';
import {
	paymentPlanLabel,
	paymentProgressLabel,
	paymentTrackingLabel,
	paymentTrackingState,
	PAYMENT_STATUS_LABELS,
	STATUS_LABELS,
} from '../../../lib/status';

export const GET: APIRoute = async ({ request }) => {
	const adminEmail = await verifyAdminSessionToken(
		parseCookie(request.headers.get('cookie'), ADMIN_COOKIE) ?? '',
	);
	if (!adminEmail) {
		return new Response('Unauthorized', { status: 401 });
	}

	const rows = await getPrisma().enrollment.findMany({
		orderBy: { createdAt: 'desc' },
		include: {
			payments: { orderBy: { installmentNumber: 'asc' } },
		},
	});

	const header = [
		'id',
		'email',
		'firstName',
		'lastName',
		'status',
		'statusLabel',
		'yousignStatus',
		'paymentPlan',
		'paymentPlanLabel',
		'installmentsPaid',
		'installmentsTotal',
		'paymentProgress',
		'collectedAmountCents',
		'totalAmountCents',
		'paymentTracking',
		'nextInstallmentDueAt',
		'subscriptionStatus',
		'lastPaymentStatus',
		'amountCents',
		'stripeCheckoutSessionId',
		'stripeSubscriptionId',
		'yousignRequestId',
		'createdAt',
		'updatedAt',
	];

	const lines = [
		header.join(','),
		...rows.map((r) => {
			const tracking = paymentTrackingState({
				status: r.status,
				installmentsPaid: r.installmentsPaid,
				installmentsTotal: r.installmentsTotal,
				subscriptionStatus: r.subscriptionStatus,
				payments: r.payments,
			});
			const lastPayment = r.payments.at(-1);

			return [
				r.id,
				r.email,
				csv(r.firstName),
				csv(r.lastName),
				r.status,
				csv(STATUS_LABELS[r.status]),
				r.yousignStatus ?? '',
				r.paymentPlan ?? '',
				csv(paymentPlanLabel(r.paymentPlan)),
				r.installmentsPaid,
				r.installmentsTotal ?? '',
				csv(
					paymentProgressLabel({
						installmentsPaid: r.installmentsPaid,
						installmentsTotal: r.installmentsTotal,
					}),
				),
				r.collectedAmountCents,
				r.totalAmountCents ?? '',
				csv(paymentTrackingLabel(tracking)),
				r.nextInstallmentDueAt?.toISOString() ?? '',
				r.subscriptionStatus ?? '',
				lastPayment ? csv(PAYMENT_STATUS_LABELS[lastPayment.status]) : '',
				r.amountCents,
				r.stripeCheckoutSessionId ?? '',
				r.stripeSubscriptionId ?? '',
				r.yousignRequestId ?? '',
				r.createdAt.toISOString(),
				r.updatedAt.toISOString(),
			].join(',');
		}),
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
