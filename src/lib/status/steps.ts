import type { YousignRequestStatus } from '../../generated/prisma/client';
import { isPaidEnough } from '../enrollment-gates';
import {
	ACCESS_STATUS_LABELS,
	COLLECTION_STATUS_LABELS,
	CONTRACT_STATUS_LABELS,
	YOUSIGN_STATUS_LABELS,
} from './labels';
import type { BadgeTone, OrthogonalStatuses, PrimaryAction, StepKey, StepState } from './types';
import { YOUSIGN_FAILURE } from './yousign';

export const TEACHIZY_ACADEMY_URL = 'https://jsmatriceacademy.teachizy.fr';

export const ENROLLMENT_POLL_INTERVAL_MS = 2_000;
export const ENROLLMENT_POLL_MAX_MS = 90_000;

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

export function stepStates(input: OrthogonalStatuses): Record<StepKey, StepState> {
	if (input.collectionStatus === 'refunded' || input.accessStatus === 'revoked') {
		return { paiement: 'termine', nda: 'a_faire', acces: 'a_faire' };
	}

	let paiement: StepState;
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
	} else if (isPaidEnough(input.collectionStatus)) {
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

/** Colonnes admin : Paiement / Signature / Accès depuis les 3 enums. */
export function adminPipelineBadges(
	input: OrthogonalStatuses & {
		yousignStatus?: YousignRequestStatus | null;
		yousignLastError?: string | null;
	},
): {
	paiement: { label: string; tone: BadgeTone };
	signature: { label: string; tone: BadgeTone };
	acces: { label: string; tone: BadgeTone };
} {
	const steps = stepStates(input);

	if (input.collectionStatus === 'refunded' || input.accessStatus === 'revoked') {
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
	} else if (input.yousignLastError && input.contractStatus === 'pending') {
		signature = { label: 'Erreur', tone: 'action' };
	} else if (steps.nda === 'en_cours') {
		signature = { label: 'En cours', tone: 'progress' };
	}

	return {
		paiement: { label: stepLabel(steps.paiement), tone: stepTone(steps.paiement) },
		signature,
		acces: { label: stepLabel(steps.acces), tone: stepTone(steps.acces) },
	};
}

export function shouldPollEnrollment(
	input: OrthogonalStatuses & {
		hasCheckoutSession?: boolean;
		hasNdaSignUrl?: boolean;
	},
): boolean {
	if (input.collectionStatus === 'pending' && input.hasCheckoutSession) return true;
	if (
		isPaidEnough(input.collectionStatus) &&
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

export function statusMessage(input: OrthogonalStatuses): string[] | null {
	if (input.accessStatus === 'active') {
		return [
			'Un email Teachizy avec vos identifiants vous a été envoyé.',
			'Si vous ne le retrouvez pas, cliquez sur « Mot de passe oublié » sur la page de connexion.',
		];
	}
	if (input.accessStatus === 'pending' && input.contractStatus === 'signed') {
		return [
			'Paiement reçu, contrat de confidentialité signé. Nous préparons votre invitation — cette page se met à jour automatiquement.',
		];
	}
	if (input.accessStatus === 'suspended') {
		return [
			'Votre accès est temporairement suspendu suite à un impayé. Régularisez pour le rétablir.',
		];
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
			label: 'Accéder à la formation',
			href: TEACHIZY_ACADEMY_URL,
		};
	}
	return { kind: 'none', label: 'Contacter un administrateur' };
}
