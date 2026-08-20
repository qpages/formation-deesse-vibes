import type { CollectionStatus, Payment, PaymentPlanId } from '../../generated/prisma/client';
import { hasFailedPayments, isOverdueForAccess } from '../enrollment-gates';
import { formatMoney, PAYMENT_PLANS } from '../payment-plans';
import type { BadgeTone, PaymentTrackingState } from './types';

export function paymentPlanLabel(plan: PaymentPlanId | null | undefined): string {
	if (!plan) return '—';
	return PAYMENT_PLANS[plan]?.label ?? plan;
}

export function paymentTrackingState(input: {
	collectionStatus: CollectionStatus;
	installmentsPaid: number;
	installmentsTotal: number | null;
	payments: Pick<Payment, 'status'>[];
}): PaymentTrackingState {
	if (input.collectionStatus === 'refunded') return 'rembourse';
	if (input.collectionStatus === 'pending') return 'en_attente';
	if (isOverdueForAccess(input.collectionStatus)) return 'impaye';
	if (input.collectionStatus === 'paid') return 'termine';

	const total = input.installmentsTotal ?? 1;
	if (input.installmentsPaid >= total) return 'termine';
	// Safety net si recompute n’a pas encore posé past_due (failed only, pas open à venir)
	if (hasFailedPayments(input.payments) && input.installmentsPaid > 0) return 'impaye';
	if (input.installmentsPaid > 0) return 'a_jour';
	return 'en_attente';
}

export function paymentTrackingTone(state: PaymentTrackingState): BadgeTone {
	switch (state) {
		case 'en_attente':
			return 'neutral';
		case 'a_jour':
			return 'progress';
		case 'termine':
			return 'success';
		case 'impaye':
			return 'action';
		case 'rembourse':
			return 'neutral';
	}
}

export function paymentTrackingLabel(state: PaymentTrackingState): string {
	switch (state) {
		case 'en_attente':
			return 'En attente';
		case 'a_jour':
			return 'À jour';
		case 'termine':
			return 'Terminé';
		case 'impaye':
			return 'Impayé';
		case 'rembourse':
			return 'Remboursé';
	}
}

export function paymentProgressLabel(input: {
	installmentsPaid: number;
	installmentsTotal: number | null;
}): string {
	const total = input.installmentsTotal ?? 1;
	return `${input.installmentsPaid}/${total}`;
}

export function paymentSummaryLine(input: {
	installmentsPaid: number;
	installmentsTotal: number | null;
	collectedAmountCents: number;
	totalAmountCents: number | null;
	currency?: string;
}): string {
	const totalInstallments = input.installmentsTotal ?? 1;
	const collected = formatMoney(input.collectedAmountCents, input.currency ?? 'eur');

	if (totalInstallments <= 1) {
		return collected;
	}

	const progress = paymentProgressLabel(input);
	if (input.totalAmountCents) {
		const total = formatMoney(input.totalAmountCents, input.currency ?? 'eur');
		return `${progress} · ${collected} / ${total}`;
	}
	return `${progress} · ${collected}`;
}
