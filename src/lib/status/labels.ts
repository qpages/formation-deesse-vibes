import type {
	AccessStatus,
	CollectionStatus,
	ContractStatus,
	PaymentStatus,
	YousignRequestStatus,
	YousignSignerStatus,
} from '../../generated/prisma/client';

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
	pending: 'Invitation en cours',
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

export const YOUSIGN_SIGNER_STATUS_LABELS: Record<YousignSignerStatus, string> = {
	initiated: 'Initié',
	notified: 'Notifié',
	verified: 'Vérifié',
	consent_given: 'Consentement',
	processing: 'Signature en cours',
	declined: 'Refusé',
	signed: 'Signé',
	aborted: 'Interrompu',
	error: 'Erreur',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
	paid: 'Payé',
	open: 'En attente',
	failed: 'Impayé',
	void: 'Annulé',
	uncollectible: 'Irrécouvrable',
	draft: 'Brouillon',
};
