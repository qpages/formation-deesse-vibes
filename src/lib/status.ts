import type { EnrollmentStatus } from '../generated/prisma/client';

export type StepKey = 'paiement' | 'nda' | 'acces';
export type StepState = 'a_faire' | 'en_cours' | 'termine' | 'action_requise';

export const STATUS_LABELS: Record<EnrollmentStatus, string> = {
	paiement_en_attente: 'Paiement en attente',
	paiement_confirme: 'Paiement confirmé',
	nda_envoye: 'Accord à signer',
	nda_signe: 'Accord signé',
	invitation_envoyee: 'Accès envoyés',
	rembourse: 'Remboursé',
	acces_retire: 'Accès retiré',
};

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
		case 'invitation_envoyee':
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
	| { kind: 'check_email'; label: string }
	| { kind: 'none'; label: string };

export function primaryAction(
	status: EnrollmentStatus,
	ndaSignUrl?: string | null,
): PrimaryAction {
	switch (status) {
		case 'paiement_en_attente':
			return { kind: 'checkout', label: 'Je m’inscris — 320 €' };
		case 'paiement_confirme':
			return { kind: 'check_email', label: 'Consulter mes e-mails' };
		case 'nda_envoye':
			return ndaSignUrl
				? { kind: 'sign_nda', label: 'Signer mon accord', href: ndaSignUrl }
				: { kind: 'check_email', label: 'Consulter mes e-mails' };
		case 'nda_signe':
		case 'invitation_envoyee':
			return { kind: 'check_email', label: 'Consulter mes e-mails' };
		default:
			return { kind: 'none', label: 'Contacter un administrateur' };
	}
}
