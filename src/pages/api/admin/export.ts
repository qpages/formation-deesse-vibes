import type { APIRoute } from 'astro';
import {
	ADMIN_COOKIE,
	parseCookie,
	verifyAdminSessionToken,
} from '../../../lib/auth/session';
import { listEnrollmentsForExport } from '../../../lib/admin/enrollments';
import {
	ACCESS_STATUS_LABELS,
	COLLECTION_STATUS_LABELS,
	CONTRACT_STATUS_LABELS,
	paymentPlanLabel,
	paymentProgressLabel,
	paymentTrackingLabel,
	paymentTrackingState,
	PAYMENT_STATUS_LABELS,
} from '../../../lib/status';

export const GET: APIRoute = async ({ request }) => {
	const adminEmail = await verifyAdminSessionToken(
		parseCookie(request.headers.get('cookie'), ADMIN_COOKIE) ?? '',
	);
	if (!adminEmail) {
		return new Response('Unauthorized', { status: 401 });
	}

	const rows = await listEnrollmentsForExport();

	const header = [
		'id',
		'email',
		'firstName',
		'lastName',
		'collectionStatus',
		'collectionStatusLabel',
		'contractStatus',
		'contractStatusLabel',
		'accessStatus',
		'accessStatusLabel',
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
				collectionStatus: r.collectionStatus,
				installmentsPaid: r.installmentsPaid,
				installmentsTotal: r.installmentsTotal,
				subscriptionStatus: r.subscriptionStatus,
				payments: r.payments,
			});
			const lastPayment = r.payments.at(-1);

			return [
				r.id,
				r.user.email,
				csv(r.user.firstName),
				csv(r.user.lastName),
				r.collectionStatus,
				csv(COLLECTION_STATUS_LABELS[r.collectionStatus]),
				r.contractStatus,
				csv(CONTRACT_STATUS_LABELS[r.contractStatus]),
				r.accessStatus,
				csv(ACCESS_STATUS_LABELS[r.accessStatus]),
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
