import type {
	AccessStatus,
	CollectionStatus,
	ContractStatus,
	Payment,
	PaymentPlanId,
	PaymentStatus,
	SubscriptionStatus,
	YousignRequestStatus,
} from '../generated/prisma/client';
import { formatMoney, PAYMENT_PLANS } from './payment-plans';

export type StepKey = 'paiement' | 'nda' | 'acces';
export type StepState = 'a_faire' | 'en_cours' | 'termine' | 'action_requise';
export type BadgeTone = 'neutral' | 'progress' | 'success' | 'action';

/** Projection UI — uniquement les 3 enums orthogonaux. */
export type OrthogonalStatuses = {
	collectionStatus: CollectionStatus;
	contractStatus: ContractStatus;
	accessStatus: AccessStatus;
};

export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, string> = {
	pending: 'En attente',
	current: 'À jour',
	past_due: 'Impayé',
	paid: 'Soldé',
	canceled: 'Annulé',
	refunded: 'Remboursé',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
	pending: 'En attente',
	sent: 'Envoyé',
	signed: 'Signé',
	expired: 'Expiré',
	declined: 'Refusé',
	canceled: 'Annulé',
	error: 'Erreur',
};

export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
	not_eligible: 'Non éligible',
	pending: 'Provisionnement',
	active: 'Actif',
	suspended: 'Suspendu',
	revoked: 'Révoqué',
};

export const YOUSIGN_STATUS_LABELS: Record<YousignRequestStatus, string> = {
	ongoing: 'En attente',
	done: 'Signé',
	expired: 'Expiré',
	declined: 'Refusé',
	canceled: 'Annulé',
	rejected: 'Rejeté',
	error: 'Erreur',
};

const YOUSIGN_FAILURE: ReadonlySet<YousignRequestStatus> = new Set([
	'expired',
	'declined',
	'canceled',
	'rejected',
	'error',
]);

export function stepTone(state: StepState): BadgeTone {
	switch (state) {
		case 'a_faire':
			return 'neutral';
		case 'en_cours':
			return 'progress';
		case 'termine':
			return 'success';
		case 'action_requise':
			return 'action';
	}
}

/** Colonnes admin : Paiement / Signature / Accès depuis les 3 enums. */
export function adminPipelineBadges(input: OrthogonalStatuses & {
	yousignStatus?: YousignRequestStatus | null;
}): {
	paiement: { label: string; tone: BadgeTone };
	signature: { label: string; tone: BadgeTone };
	acces: { label: string; tone: BadgeTone };
} {
	const steps = stepStates(input);

	if (
		input.collectionStatus === 'refunded' ||
		input.accessStatus === 'revoked'
	) {
		return {
			paiement: {
				label: COLLECTION_STATUS_LABELS[input.collectionStatus],
				tone: 'neutral',
			},
			signature: {
				label: input.yousignStatus
					? YOUSIGN_STATUS_LABELS[input.yousignStatus]
					: CONTRACT_STATUS_LABELS[input.contractStatus],
				tone: 'neutral',
			},
			acces: {
				label: ACCESS_STATUS_LABELS[input.accessStatus],
				tone: 'neutral',
			},
		};
	}

	let signature = {
		label: stepLabel(steps.nda),
		tone: stepTone(steps.nda),
	};

	if (input.yousignStatus && YOUSIGN_FAILURE.has(input.yousignStatus)) {
		signature = {
			label: YOUSIGN_STATUS_LABELS[input.yousignStatus],
			tone: 'action',
		};
	} else if (input.yousignStatus === 'done' || input.contractStatus === 'signed') {
		signature = { label: 'Signé', tone: 'success' };
	} else if (input.yousignStatus === 'ongoing' || input.contractStatus === 'sent') {
		signature = { label: 'En attente', tone: 'action' };
	} else if (steps.nda === 'en_cours') {
		signature = { label: 'En cours', tone: 'progress' };
	}

	return {
		paiement: { label: stepLabel(steps.paiement), tone: stepTone(steps.paiement) },
		signature,
		acces: { label: stepLabel(steps.acces), tone: stepTone(steps.acces) },
	};
}

/** Mappe un event_name Yousign vers un statut de demande. */
export function yousignStatusFromEvent(
	eventName: string,
): YousignRequestStatus | null {
	switch (eventName) {
		case 'signature_request.done':
			return 'done';
		case 'signature_request.expired':
			return 'expired';
		case 'signature_request.declined':
		case 'signer.declined':
			return 'declined';
		case 'signature_request.canceled':
		case 'signature_request.deleted':
			return 'canceled';
		case 'signature_request.rejected':
			return 'rejected';
		case 'signer.error':
		case 'signer.notification_delivery_failed':
			return 'error';
		default:
			return null;
	}
}

/** Mappe le `status` API d’une Signature Request vers l’enum Prisma. */
export function mapYousignApiStatus(
	apiStatus: string,
): YousignRequestStatus | null {
	switch (apiStatus.toLowerCase()) {
		case 'draft':
		case 'approval':
		case 'paused':
		case 'ongoing':
			return 'ongoing';
		case 'done':
			return 'done';
		case 'expired':
			return 'expired';
		case 'declined':
			return 'declined';
		case 'canceled':
		case 'deleted':
			return 'canceled';
		case 'rejected':
			return 'rejected';
		default:
			return null;
	}
}

export function stepStates(input: OrthogonalStatuses): Record<StepKey, StepState> {
	if (input.collectionStatus === 'refunded' || input.accessStatus === 'revoked') {
		return { paiement: 'termine', nda: 'a_faire', acces: 'a_faire' };
	}

	let paiement: StepState = 'a_faire';
	if (input.collectionStatus === 'pending') {
		paiement = 'en_cours';
	} else if (input.collectionStatus === 'past_due') {
		paiement = 'action_requise';
	} else {
		paiement = 'termine';
	}

	let nda: StepState = 'a_faire';
	if (input.contractStatus === 'signed') {
		nda = 'termine';
	} else if (input.contractStatus === 'sent') {
		nda = 'action_requise';
	} else if (input.collectionStatus !== 'pending') {
		nda = 'en_cours';
	}

	let acces: StepState = 'a_faire';
	if (input.accessStatus === 'active') {
		acces = 'termine';
	} else if (input.accessStatus === 'pending' || input.accessStatus === 'suspended') {
		acces = input.accessStatus === 'suspended' ? 'action_requise' : 'en_cours';
	}

	return { paiement, nda, acces };
}

export function stepLabel(state: StepState): string {
	switch (state) {
		case 'a_faire':
			return 'À faire';
		case 'en_cours':
			return 'En cours';
		case 'termine':
			return 'Terminé';
		case 'action_requise':
			return 'Action requise';
	}
}

export type PrimaryAction =
	| { kind: 'checkout'; label: string }
	| { kind: 'sign_nda'; label: string; href: string }
	| { kind: 'refresh'; label: string }
	| { kind: 'open_platform'; label: string; href: string }
	| { kind: 'none'; label: string };

export const TEACHIZY_ACADEMY_URL = 'https://jsmatriceacademy.teachizy.fr';

export const ENROLLMENT_POLL_INTERVAL_MS = 2_000;
export const ENROLLMENT_POLL_MAX_MS = 90_000;

export function shouldPollEnrollment(input: OrthogonalStatuses & {
	hasCheckoutSession?: boolean;
	hasNdaSignUrl?: boolean;
}): boolean {
	if (input.collectionStatus === 'pending' && input.hasCheckoutSession) return true;
	if (
		input.collectionStatus !== 'pending' &&
		input.contractStatus === 'pending' &&
		!input.hasNdaSignUrl
	) {
		return true;
	}
	if (input.accessStatus === 'pending') return true;
	return false;
}

export function checkoutSuccessFlash(input: OrthogonalStatuses): string | null {
	if (input.collectionStatus === 'pending') {
		return 'Paiement en cours de confirmation. Cette page se met à jour automatiquement.';
	}
	if (input.contractStatus === 'sent') {
		return 'Paiement reçu. Signez votre accord de confidentialité pour continuer.';
	}
	if (input.contractStatus === 'pending') {
		return 'Paiement reçu. Nous préparons votre accord de confidentialité.';
	}
	return null;
}

export function statusMessage(input: OrthogonalStatuses): string | null {
	if (input.accessStatus === 'active') {
		return 'Un email Teachizy avec vos identifiants vous a été envoyé. Si vous ne le retrouvez pas, cliquez sur « Mot de passe oublié » sur la page de connexion.';
	}
	if (input.accessStatus === 'pending' && input.contractStatus === 'signed') {
		return 'Paiement reçu, contrat de confidentialité signé. Nous préparons votre invitation — cette page se met à jour automatiquement.';
	}
	if (input.accessStatus === 'suspended') {
		return 'Votre accès est temporairement suspendu suite à un impayé. Régularisez pour le rétablir.';
	}
	if (input.accessStatus === 'revoked' || input.collectionStatus === 'refunded') {
		return null;
	}
	return null;
}

export function primaryAction(
	input: OrthogonalStatuses,
	ndaSignUrl?: string | null,
): PrimaryAction {
	if (input.accessStatus === 'revoked' || input.collectionStatus === 'refunded') {
		return { kind: 'none', label: 'Contacter un administrateur' };
	}
	if (input.collectionStatus === 'pending') {
		return { kind: 'checkout', label: 'Je m’inscris' };
	}
	if (input.contractStatus === 'pending' || input.contractStatus === 'sent') {
		return ndaSignUrl
			? { kind: 'sign_nda', label: 'Signer mon accord', href: ndaSignUrl }
			: { kind: 'refresh', label: 'Actualiser' };
	}
	if (input.accessStatus === 'pending' || input.accessStatus === 'not_eligible') {
		return { kind: 'refresh', label: 'Actualiser' };
	}
	if (input.accessStatus === 'active') {
		return {
			kind: 'open_platform',
			label: 'Entrer dans la formation',
			href: TEACHIZY_ACADEMY_URL,
		};
	}
	return { kind: 'none', label: 'Contacter un administrateur' };
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
	paid: 'Payé',
	open: 'En attente',
	failed: 'Impayé',
	void: 'Annulé',
	uncollectible: 'Irrécouvrable',
	draft: 'Brouillon',
};

export function paymentPlanLabel(plan: PaymentPlanId | null | undefined): string {
	if (!plan) return '—';
	return PAYMENT_PLANS[plan]?.label ?? plan;
}

export type PaymentTrackingState =
	| 'en_attente'
	| 'a_jour'
	| 'impaye'
	| 'termine'
	| 'rembourse';

export function paymentTrackingState(input: {
	collectionStatus: CollectionStatus;
	installmentsPaid: number;
	installmentsTotal: number | null;
	subscriptionStatus: SubscriptionStatus | null;
	payments: Pick<Payment, 'status'>[];
}): PaymentTrackingState {
	if (input.collectionStatus === 'refunded') return 'rembourse';
	if (input.collectionStatus === 'pending') return 'en_attente';
	if (input.collectionStatus === 'past_due') return 'impaye';
	if (input.collectionStatus === 'paid') return 'termine';

	const hasFailed = input.payments.some((p) => p.status === 'failed' || p.status === 'open');
	const total = input.installmentsTotal ?? 1;
	const allPaid = input.installmentsPaid >= total;

	if (allPaid || input.subscriptionStatus === 'completed') return 'termine';
	if (hasFailed && input.installmentsPaid > 0) return 'impaye';
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
	return `${input.installmentsPaid}/${total} échéance${total > 1 ? 's' : ''}`;
}

export function paymentSummaryLine(input: {
	installmentsPaid: number;
	installmentsTotal: number | null;
	collectedAmountCents: number;
	totalAmountCents: number | null;
	currency?: string;
}): string {
	const progress = paymentProgressLabel(input);
	const collected = formatMoney(input.collectedAmountCents, input.currency ?? 'eur');
	if (input.totalAmountCents) {
		const total = formatMoney(input.totalAmountCents, input.currency ?? 'eur');
		return `${progress} · ${collected} / ${total}`;
	}
	return `${progress} · ${collected}`;
}
