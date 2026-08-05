import { z } from 'zod';
import type {
	AccessStatus,
	CollectionStatus,
	ContractStatus,
	Enrollment,
} from '../../generated/prisma/client';

export const adminActionZones = ['metier', 'recovery'] as const;
export type AdminActionZone = (typeof adminActionZones)[number];

export const adminActionKeys = [
	'relance_nda',
	'recreate_nda',
	'retrigger_teachizy',
	'mark_refunded',
	'revoke_access',
	'sync_payment',
	'sync_yousign',
	'retrigger_nda',
	'retrigger_signature',
	'delete_nda',
] as const;

export type AdminActionKey = (typeof adminActionKeys)[number];

export const adminActionKeySchema = z.enum(adminActionKeys);

export interface AdminActionDef {
	action: AdminActionKey;
	label: string;
	zone: AdminActionZone;
	eyebrow: string;
	title: string;
	description: string;
	confirm: string;
	danger?: boolean;
}

/** Descriptions use `{name}` — remplacé côté client. */
export const ADMIN_ACTIONS: AdminActionDef[] = [
	{
		action: 'relance_nda',
		label: 'Relancer la signature',
		zone: 'metier',
		eyebrow: 'Signature',
		title: 'Relancer le NDA',
		description:
			'Envoyer une relance NDA pour {name} via Inngest (réactive le lien Yousign si possible).',
		confirm: 'Envoyer la relance',
	},
	{
		action: 'recreate_nda',
		label: 'Recréer le NDA',
		zone: 'metier',
		eyebrow: 'Signature',
		title: 'Recréer le NDA',
		description:
			'Déclencher via Inngest une nouvelle demande Yousign pour {name}. L’ancien lien ne sera plus valide.',
		confirm: 'Recréer le NDA',
		danger: true,
	},
	{
		action: 'retrigger_teachizy',
		label: 'Renvoyer Teachizy',
		zone: 'metier',
		eyebrow: 'Accès',
		title: 'Renvoyer le lien Teachizy',
		description:
			'Déclencher le job Inngest d’invitation / réactivation Teachizy pour {name} (selon la politique d’accès).',
		confirm: 'Renvoyer le lien',
	},
	{
		action: 'mark_refunded',
		label: 'Marquer remboursé',
		zone: 'metier',
		eyebrow: 'Paiement',
		title: 'Marquer comme remboursé',
		description:
			'Passer {name} en collectionStatus « remboursé », puis appliquer la politique d’accès (révocation / suspension Teachizy via Inngest si besoin). Le remboursement Stripe reste à faire dans le Dashboard.',
		confirm: 'Marquer remboursé',
		danger: true,
	},
	{
		action: 'revoke_access',
		label: 'Retirer l’accès',
		zone: 'metier',
		eyebrow: 'Accès',
		title: 'Retirer l’accès',
		description:
			'Passer {name} en accessStatus « révoqué », puis appliquer la politique d’accès (suspension Teachizy via Inngest).',
		confirm: 'Retirer l’accès',
		danger: true,
	},
	{
		action: 'sync_payment',
		label: 'Sync paiement Stripe',
		zone: 'recovery',
		eyebrow: 'Recovery',
		title: 'Synchroniser le paiement',
		description:
			'Lire la session Stripe de {name}, recalculer la collection, puis réévaluer l’accès. Peut enchaîner la création NDA si éligible.',
		confirm: 'Synchroniser',
	},
	{
		action: 'sync_yousign',
		label: 'Sync statut Yousign',
		zone: 'recovery',
		eyebrow: 'Recovery',
		title: 'Synchroniser Yousign',
		description:
			'Lire le statut Yousign de {name} et aligner contractStatus / yousignStatus en base (sync lecture).',
		confirm: 'Synchroniser',
	},
	{
		action: 'retrigger_nda',
		label: 'Rejouer Inngest NDA',
		zone: 'recovery',
		eyebrow: 'Recovery',
		title: 'Déclencher création NDA (Inngest)',
		description:
			'Envoyer l’event Inngest stripe/payment.confirmed pour {name}. Utile si le job a raté après un paiement déjà confirmé.',
		confirm: 'Déclencher Inngest',
	},
	{
		action: 'retrigger_signature',
		label: 'Rejouer Inngest Teachizy',
		zone: 'recovery',
		eyebrow: 'Recovery',
		title: 'Déclencher invitation Teachizy (Inngest)',
		description:
			'Envoyer l’event Inngest enrollment/access.grant pour {name}. Utile si le grant a raté après une signature.',
		confirm: 'Déclencher Inngest',
	},
	{
		action: 'delete_nda',
		label: 'Effacer NDA (base)',
		zone: 'recovery',
		eyebrow: 'Recovery',
		title: 'Supprimer le NDA',
		description:
			'Effacer les IDs YouSign de {name} en base et remettre contractStatus en attente. Ne supprime pas la demande côté Yousign.',
		confirm: 'Supprimer le NDA',
		danger: true,
	},
];

export const METIER_ACTIONS = ADMIN_ACTIONS.filter((a) => a.zone === 'metier');
export const RECOVERY_ACTIONS = ADMIN_ACTIONS.filter((a) => a.zone === 'recovery');

export type AdminActionMetaClient = Record<
	AdminActionKey,
	{
		eyebrow: string;
		title: string;
		description: string;
		confirm: string;
		danger?: boolean;
	}
>;

export function adminActionMetaForClient(): AdminActionMetaClient {
	return Object.fromEntries(
		ADMIN_ACTIONS.map((a) => [
			a.action,
			{
				eyebrow: a.eyebrow,
				title: a.title,
				description: a.description,
				confirm: a.confirm,
				...(a.danger ? { danger: true } : {}),
			},
		]),
	) as AdminActionMetaClient;
}

type VisibilityInput = Pick<
	Enrollment,
	| 'collectionStatus'
	| 'contractStatus'
	| 'accessStatus'
	| 'yousignRequestId'
	| 'stripeCheckoutSessionId'
>;

/**
 * Miroir des gates API (sync). L’API reste source de vérité (cooldown relance, etc.).
 * Garder sync avec `dispatch.ts`.
 */
export function isActionVisible(action: AdminActionKey, e: VisibilityInput): boolean {
	const paidEnough = e.collectionStatus !== 'pending' && e.collectionStatus !== 'canceled';

	switch (action) {
		case 'relance_nda':
			return (
				paidEnough &&
				(e.contractStatus === 'sent' || e.contractStatus === 'pending') &&
				e.accessStatus === 'not_eligible' &&
				Boolean(e.yousignRequestId)
			);
		case 'recreate_nda':
			return paidEnough && e.contractStatus !== 'signed';
		case 'retrigger_teachizy':
			return e.accessStatus !== 'revoked' && e.contractStatus === 'signed';
		case 'mark_refunded':
			return e.collectionStatus !== 'refunded';
		case 'revoke_access':
			return e.accessStatus !== 'revoked' && e.collectionStatus !== 'refunded';
		case 'sync_payment':
			return Boolean(e.stripeCheckoutSessionId);
		case 'sync_yousign':
			return Boolean(e.yousignRequestId);
		case 'retrigger_nda':
			return paidEnough;
		case 'retrigger_signature':
			return Boolean(e.yousignRequestId) && e.accessStatus !== 'revoked';
		case 'delete_nda':
			return Boolean(e.yousignRequestId) || e.contractStatus !== 'pending';
		default:
			return false;
	}
}

export function visibleActions(e: VisibilityInput): AdminActionKey[] {
	return adminActionKeys.filter((action) => isActionVisible(action, e));
}

export function visibleActionDefs(e: VisibilityInput): AdminActionDef[] {
	const allowed = new Set(visibleActions(e));
	return ADMIN_ACTIONS.filter((a) => allowed.has(a.action));
}

export const COLLECTION_FILTER_VALUES = [
	'pending',
	'current',
	'past_due',
	'paid',
	'canceled',
	'refunded',
] as const satisfies readonly CollectionStatus[];

export const CONTRACT_FILTER_VALUES = [
	'pending',
	'sent',
	'signed',
	'expired',
	'declined',
	'canceled',
	'error',
] as const satisfies readonly ContractStatus[];

export const ACCESS_FILTER_VALUES = [
	'not_eligible',
	'pending',
	'active',
	'suspended',
	'revoked',
] as const satisfies readonly AccessStatus[];
