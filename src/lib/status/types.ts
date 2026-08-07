import type {
	AccessStatus,
	CollectionStatus,
	ContractStatus,
} from '../../generated/prisma/client';

export type StepKey = 'paiement' | 'nda' | 'acces';
export type StepState = 'a_faire' | 'en_cours' | 'termine' | 'action_requise';
export type BadgeTone = 'neutral' | 'progress' | 'success' | 'action';

/** Projection UI — uniquement les 3 enums orthogonaux. */
export type OrthogonalStatuses = {
	collectionStatus: CollectionStatus;
	contractStatus: ContractStatus;
	accessStatus: AccessStatus;
};

export type PrimaryAction =
	| { kind: 'checkout'; label: string }
	| { kind: 'sign_nda'; label: string; href: string }
	| { kind: 'refresh'; label: string }
	| { kind: 'open_platform'; label: string; href: string }
	| { kind: 'none'; label: string };

export type PaymentTrackingState =
	| 'en_attente'
	| 'a_jour'
	| 'impaye'
	| 'termine'
	| 'rembourse';
