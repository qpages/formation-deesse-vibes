import { z } from 'zod';
import type { PaymentPlanId as PrismaPaymentPlanId } from '../generated/prisma/client';
import { getEnv } from './env';

/** Aligné sur l’enum Prisma `PaymentPlanId`. */
export const PAYMENT_PLAN_IDS = [
	'unique',
	'x2',
	'x4',
	'x6',
] as const satisfies readonly PrismaPaymentPlanId[];

export const paymentPlanIdSchema = z.enum(PAYMENT_PLAN_IDS);
export type PaymentPlanId = (typeof PAYMENT_PLAN_IDS)[number];

export type PaymentPlanMode = 'payment' | 'subscription';

export interface PaymentPlan {
	id: PaymentPlanId;
	label: string;
	mode: PaymentPlanMode;
	installments: number;
	installmentAmountCents: number;
	totalAmountCents: number;
	envPriceKey: 'STRIPE_PRICE_UNIQUE' | 'STRIPE_PRICE_X2' | 'STRIPE_PRICE_X4' | 'STRIPE_PRICE_X6';
}

/** Source de vérité serveur — ne jamais faire confiance au montant côté client. */
export const PAYMENT_PLANS: Record<PaymentPlanId, PaymentPlan> = {
	unique: {
		id: 'unique',
		label: 'Paiement unique',
		mode: 'payment',
		installments: 1,
		installmentAmountCents: 184_900,
		totalAmountCents: 184_900,
		envPriceKey: 'STRIPE_PRICE_UNIQUE',
	},
	x2: {
		id: 'x2',
		label: '2 échéances',
		mode: 'subscription',
		installments: 2,
		installmentAmountCents: 94_950,
		totalAmountCents: 189_900,
		envPriceKey: 'STRIPE_PRICE_X2',
	},
	x4: {
		id: 'x4',
		label: '4 échéances',
		mode: 'subscription',
		installments: 4,
		installmentAmountCents: 49_975,
		totalAmountCents: 199_900,
		envPriceKey: 'STRIPE_PRICE_X4',
	},
	x6: {
		id: 'x6',
		label: '6 échéances',
		mode: 'subscription',
		installments: 6,
		installmentAmountCents: 34_650,
		totalAmountCents: 207_900,
		envPriceKey: 'STRIPE_PRICE_X6',
	},
};

export function getPaymentPlan(id: PaymentPlanId): PaymentPlan {
	return PAYMENT_PLANS[id];
}

export function resolvePaymentPlan(raw: string): PaymentPlan | null {
	const parsed = paymentPlanIdSchema.safeParse(raw);
	if (!parsed.success) return null;
	return PAYMENT_PLANS[parsed.data];
}

export function formatMoney(cents: number, currency = 'eur'): string {
	return new Intl.NumberFormat('fr-FR', {
		style: 'currency',
		currency: currency.toUpperCase(),
	}).format(cents / 100);
}

/** Libellé court du plan échelonné (espace apprenant, admin). */
export function installmentPlanSummary(plan: PaymentPlan): string {
	if (plan.installments <= 1) return 'Paiement unique';
	const total = formatMoney(plan.totalAmountCents);
	const installment = formatMoney(plan.installmentAmountCents);
	return `Paiement de ${total} en ${plan.installments} mensualités de ${installment}`;
}

/** Message Stripe Checkout sous le bouton de paiement (abonnement échelonné). */
export function installmentCheckoutMessage(plan: PaymentPlan): string {
	const summary = installmentPlanSummary(plan);
	if (plan.installments <= 1) return summary;
	return `${summary}. Arrêt automatique de l'abonnement à l'issue de la dernière échéance.`;
}

export function paidInvoiceLabel(
	amountCents: number,
	paidAt: Date | null,
	currency = 'eur',
): string {
	const amount = formatMoney(amountCents, currency);
	if (!paidAt) return `Facture de ${amount}`;
	return `Facture de ${amount} payé le ${paidAt.toLocaleDateString('fr-FR')}`;
}

export function stripePriceIdForPlan(plan: PaymentPlan): string {
	const env = getEnv();

	switch (plan.envPriceKey) {
		case 'STRIPE_PRICE_UNIQUE':
			return env.STRIPE_PRICE_UNIQUE ?? env.STRIPE_PRICE_ID;
		case 'STRIPE_PRICE_X2':
			return requirePrice(env.STRIPE_PRICE_X2, 'STRIPE_PRICE_X2');
		case 'STRIPE_PRICE_X4':
			return requirePrice(env.STRIPE_PRICE_X4, 'STRIPE_PRICE_X4');
		case 'STRIPE_PRICE_X6':
			return requirePrice(env.STRIPE_PRICE_X6, 'STRIPE_PRICE_X6');
	}
}

function requirePrice(value: string | undefined, key: string): string {
	if (!value) {
		throw new Error(`Variable d'environnement manquante: ${key}`);
	}
	return value;
}
