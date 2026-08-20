import { projectFutureInstallmentDueDates } from './subscription-dates';

export type InstallmentProjectionContext = {
	total: number;
	estimatedCents: number;
	projectedDueDates: Map<number, Date>;
};

export function computeInstallmentProjection(input: {
	installmentsPaid: number;
	installmentsTotal: number | null;
	totalAmountCents: number | null;
	collectedAmountCents: number;
	nextInstallmentDueAt: Date | null;
	currentPeriodEnd: Date | null;
	existingPaymentCount: number;
}): InstallmentProjectionContext {
	const total = input.installmentsTotal ?? Math.max(input.existingPaymentCount, 1);
	const remainingCents = Math.max(
		0,
		(input.totalAmountCents ?? input.collectedAmountCents) - input.collectedAmountCents,
	);
	const remainingSlots = Math.max(0, total - input.installmentsPaid);
	const estimatedCents = remainingSlots > 0 ? Math.round(remainingCents / remainingSlots) : 0;

	const anchor = input.nextInstallmentDueAt ?? input.currentPeriodEnd;
	let projectedDueDates = new Map<number, Date>();
	if (anchor && input.installmentsPaid < total) {
		projectedDueDates = projectFutureInstallmentDueDates({
			anchorDueAt: anchor,
			anchorInstallment: input.installmentsPaid + 1,
			installmentsTotal: total,
		});
	}

	return { total, estimatedCents, projectedDueDates };
}

/**
 * Complète les paiements connus avec des échéances estimées.
 * Aucune ligne synthétique tant que Stripe n’a produit au moins un paiement.
 */
export function expandInstallmentRows<T extends { installmentNumber: number }>(input: {
	payments: T[];
	projection: InstallmentProjectionContext;
	createEstimated: (
		installmentNumber: number,
		estimatedCents: number,
		dueAt: Date | null,
	) => T;
}): Array<T & { isEstimated: boolean }> {
	if (input.payments.length === 0) return [];

	const { total, estimatedCents, projectedDueDates } = input.projection;
	const byNumber = new Map(input.payments.map((payment) => [payment.installmentNumber, payment]));
	const rows: Array<T & { isEstimated: boolean }> = [];

	for (let n = 1; n <= total; n++) {
		const existing = byNumber.get(n);
		if (existing) {
			rows.push({ ...existing, isEstimated: false });
			continue;
		}

		rows.push({
			...input.createEstimated(n, estimatedCents, projectedDueDates.get(n) ?? null),
			isEstimated: true,
		});
	}

	return rows;
}
