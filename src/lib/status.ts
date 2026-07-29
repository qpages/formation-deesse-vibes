import type {
	EnrollmentStatus,
	YousignRequestStatus,
} from '../generated/prisma/client';

export type StepKey = 'paiement' | 'nda' | 'acces';
export type StepState = 'a_faire' | 'en_cours' | 'termine' | 'action_requise';
export type BadgeTone = 'neutral' | 'progress' | 'success' | 'action';

export const STATUS_LABELS: Record<EnrollmentStatus, string> = {
	paiement_en_attente: 'Paiement en attente',
	paiement_confirme: 'Paiement confirmé',
	nda_envoye: 'Accord à signer',
	nda_signe: 'Accord signé',
	teachizy_envoye: 'Accès envoyés',
	rembourse: 'Remboursé',
	acces_retire: 'Accès retiré',
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

/** Colonnes admin : Paiement / Signature / Accès (pas un seul statut global). */
export function adminPipelineBadges(input: {
	status: EnrollmentStatus;
	yousignStatus?: YousignRequestStatus | null;
}): {
	paiement: { label: string; tone: BadgeTone };
	signature: { label: string; tone: BadgeTone };
	acces: { label: string; tone: BadgeTone };
} {
	const steps = stepStates(input.status);

	if (input.status === 'rembourse' || input.status === 'acces_retire') {
		return {
			paiement: {
				label: STATUS_LABELS[input.status],
				tone: 'neutral',
			},
			signature: {
				label: input.yousignStatus
					? YOUSIGN_STATUS_LABELS[input.yousignStatus]
					: '—',
				tone: 'neutral',
			},
			acces: { label: STATUS_LABELS[input.status], tone: 'neutral' },
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
	} else if (input.yousignStatus === 'done' || steps.nda === 'termine') {
		signature = { label: 'Signé', tone: 'success' };
	} else if (input.yousignStatus === 'ongoing' || steps.nda === 'action_requise') {
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

export function stepStates(status: EnrollmentStatus): Record<StepKey, StepState> {
	switch (status) {
		case 'paiement_en_attente':
			return { paiement: 'en_cours', nda: 'a_faire', acces: 'a_faire' };
		case 'paiement_confirme':
			return { paiement: 'termine', nda: 'en_cours', acces: 'a_faire' };
		case 'nda_envoye':
			return { paiement: 'termine', nda: 'action_requise', acces: 'a_faire' };
		case 'nda_signe':
			return { paiement: 'termine', nda: 'termine', acces: 'en_cours' };
		case 'teachizy_envoye':
			return { paiement: 'termine', nda: 'termine', acces: 'termine' };
		case 'rembourse':
		case 'acces_retire':
			return { paiement: 'termine', nda: 'a_faire', acces: 'a_faire' };
		default:
			return { paiement: 'a_faire', nda: 'a_faire', acces: 'a_faire' };
	}
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

/** Bandeau au retour Stripe (`?checkout=success`). Null = laisser le panneau parler. */
export function checkoutSuccessFlash(status: EnrollmentStatus): string | null {
	switch (status) {
		case 'paiement_en_attente':
			return 'Paiement en cours de confirmation. Rechargez cette page dans un instant.';
		case 'paiement_confirme':
			return 'Paiement reçu. Nous préparons votre accord de confidentialité.';
		case 'nda_envoye':
			return 'Paiement reçu. Signez votre accord de confidentialité pour continuer.';
		default:
			return null;
	}
}

/** Message principal sous « Votre inscription ». */
export function statusMessage(status: EnrollmentStatus): string | null {
	switch (status) {
		case 'nda_signe':
			return 'Paiement reçu, contrat de confidentialité signé. Nous préparons votre invitation à rejoindre la formation.';
		case 'teachizy_envoye':
			return 'Un email Teachizy avec vos identifiants vous a été envoyé. Si vous ne le retrouvez pas, cliquez sur « Mot de passe oublié » sur la page de connexion.';
		case 'rembourse':
		case 'acces_retire':
			return null;
		default:
			return null;
	}
}

export function primaryAction(
	status: EnrollmentStatus,
	ndaSignUrl?: string | null,
): PrimaryAction {
	switch (status) {
		case 'paiement_en_attente':
			return { kind: 'checkout', label: 'Je m’inscris — 320 €' };
		case 'paiement_confirme':
		case 'nda_envoye':
			return ndaSignUrl
				? { kind: 'sign_nda', label: 'Signer mon accord', href: ndaSignUrl }
				: { kind: 'refresh', label: 'Actualiser' };
		case 'nda_signe':
			return { kind: 'refresh', label: 'Actualiser' };
		case 'teachizy_envoye':
			return {
				kind: 'open_platform',
				label: 'Entrer dans la formation',
				href: TEACHIZY_ACADEMY_URL,
			};
		default:
			return { kind: 'none', label: 'Contacter un administrateur' };
	}
}
