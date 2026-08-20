import { z } from 'zod';
import type {
	AccessStatus,
	CollectionStatus,
	ContractStatus,
	Enrollment,
} from '../../generated/prisma/client';
import { isAwaitingNda, isPaidEnough } from '../enrollment-gates';
import {
	resolveExternalRequestId,
	resolveExternalSignerId,
	resolveSignKind,
} from '../signature/nda-request';

export const adminActionZones = ['metier', 'actions'] as const;
export type AdminActionZone = (typeof adminActionZones)[number];

/**
 * Nature d'exécution de l'action — sépare deux contrats d'erreur distincts :
 * - `sync`  : effet primaire = lecture provider + miroir DB. L'enqueue Inngest
 *             éventuel est best-effort (une file HS n'échoue pas l'action).
 * - `flow`  : effet primaire = enqueue Inngest (le job EST l'action). File HS = échec.
 * - `read`  : lecture pure, aucun effet de bord persistant (ex. copier un lien).
 */
export const adminActionExecutions = ['sync', 'flow', 'read'] as const;
export type AdminActionExecution = (typeof adminActionExecutions)[number];

export const adminActionKeys = [
	'resend_nda',
	'retrigger_teachizy',
	'sync_teachizy',
	'sync_payment',
	'sync_nda',
	'recreate_nda',
	'copy_nda_link',
] as const;

export type AdminActionKey = (typeof adminActionKeys)[number];

export const adminActionKeySchema = z.enum(adminActionKeys);

export interface AdminActionDef {
	action: AdminActionKey;
	label: string;
	zone: AdminActionZone;
	execution: AdminActionExecution;
	eyebrow: string;
	title: string;
	description: string;
	confirm: string;
}

/** Descriptions use `{name}` — remplacé côté client. */
export const ADMIN_ACTIONS: AdminActionDef[] = [
	{
		action: 'copy_nda_link',
		label: 'Copier le lien de signature',
		zone: 'metier',
		execution: 'read',
		eyebrow: 'Signature',
		title: 'Copier le lien de signature',
		description:
			'Récupérer le lien de signature actuel de {name} et le copier dans le presse-papiers (fetch live, non stocké).',
		confirm: 'Copier le lien',
	},
	{
		action: 'retrigger_teachizy',
		label: 'Inviter à la formation',
		zone: 'actions',
		execution: 'flow',
		eyebrow: 'Action',
		title: 'Inviter à la formation',
		description:
			'Envoyer / réactiver l’invitation Teachizy pour {name} (selon la politique d’accès).',
		confirm: 'Inviter',
	},
	{
		action: 'sync_teachizy',
		label: 'Sync statut Teachizy',
		zone: 'actions',
		execution: 'sync',
		eyebrow: 'Accès',
		title: 'Synchroniser Teachizy',
		description:
			'Lire le compte Teachizy de {name} et poser accessStatus=active si la formation est déjà là. Aucune invitation envoyée.',
		confirm: 'Synchroniser',
	},
	{
		action: 'sync_payment',
		label: 'Sync paiement Stripe',
		zone: 'actions',
		execution: 'sync',
		eyebrow: 'Action',
		title: 'Synchroniser le paiement',
		description:
			'Lire la session Stripe de {name} et aligner la collection en base. Déclenche la création du NDA s’il manque (si la file est disponible).',
		confirm: 'Synchroniser',
	},
	{
		action: 'sync_nda',
		label: 'Sync NDA',
		zone: 'actions',
		execution: 'sync',
		eyebrow: 'Action',
		title: 'Synchroniser le NDA',
		description:
			'Lire le statut de signature de {name} chez le provider et aligner contractStatus. Invite Teachizy si le NDA est signé (si la file est disponible).',
		confirm: 'Synchroniser',
	},
	{
		action: 'resend_nda',
		label: 'Renvoyer le lien de signature',
		zone: 'actions',
		execution: 'flow',
		eyebrow: 'Action',
		title: 'Renvoyer le lien de signature',
		description:
			'Renvoyer à {name} le même lien de signature (réactivation). L’ancien lien reste valide.',
		confirm: 'Renvoyer le lien',
	},
	{
		action: 'recreate_nda',
		label: 'Recréer un lien de signature',
		zone: 'actions',
		execution: 'flow',
		eyebrow: 'Action',
		title: 'Recréer un lien de signature',
		description:
			'Créer une nouvelle demande de signature pour {name}. L’ancien lien ne sera plus valide.',
		confirm: 'Recréer le lien',
	},
];

export const METIER_ACTIONS = ADMIN_ACTIONS.filter((a) => a.zone === 'metier');
export const ZONE_ACTIONS = ADMIN_ACTIONS.filter((a) => a.zone === 'actions');

export type AdminActionMetaClient = Record<
	AdminActionKey,
	{
		eyebrow: string;
		title: string;
		description: string;
		confirm: string;
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
			},
		]),
	) as AdminActionMetaClient;
}

type VisibilityInput = Pick<
	Enrollment,
	'collectionStatus' | 'contractStatus' | 'accessStatus' | 'stripeCheckoutSessionId'
> & {
	ndaRequest?: {
		provider: 'yousign' | 'docuseal';
		externalRequestId: string;
		externalSignerId: string | null;
		signKind?: 'embed' | 'redirect';
	} | null;
};

/** Miroir des gates API (sync). L’API reste source de vérité (cooldown relance, etc.). */
export function isActionVisible(action: AdminActionKey, e: VisibilityInput): boolean {
	const paidEnough = isPaidEnough(e.collectionStatus);
	const requestId = resolveExternalRequestId(e);
	const signerId = resolveExternalSignerId(e);

	switch (action) {
		case 'resend_nda':
			return isAwaitingNda(e) && Boolean(requestId) && resolveSignKind(e) === 'redirect';
		case 'copy_nda_link':
			return (
				e.contractStatus === 'sent' &&
				Boolean(requestId) &&
				Boolean(signerId) &&
				resolveSignKind(e) === 'redirect'
			);
		case 'recreate_nda':
			return paidEnough && e.contractStatus !== 'signed';
		case 'retrigger_teachizy':
			return e.accessStatus !== 'revoked' && e.contractStatus === 'signed';
		case 'sync_teachizy':
			return e.accessStatus !== 'revoked' && e.contractStatus === 'signed';
		case 'sync_payment':
			return Boolean(e.stripeCheckoutSessionId);
		case 'sync_nda':
			return Boolean(requestId);
		default:
			return false;
	}
}

export function adminActionExecution(action: AdminActionKey): AdminActionExecution {
	return ADMIN_ACTIONS.find((a) => a.action === action)?.execution ?? 'flow';
}

export function visibleActions(e: VisibilityInput): AdminActionKey[] {
	return adminActionKeys.filter((action) => isActionVisible(action, e));
}

export function visibleActionDefs(e: VisibilityInput): AdminActionDef[] {
	const allowed = new Set(visibleActions(e));
	return ADMIN_ACTIONS.filter((a) => allowed.has(a.action));
}

const SIGNATURE_PANEL_ACTIONS = new Set<AdminActionKey>(['copy_nda_link']);
const ACCESS_PANEL_ACTIONS = new Set<AdminActionKey>([]);

export type PartitionedAdminActions = {
	signature: AdminActionDef[];
	access: AdminActionDef[];
	actions: AdminActionDef[];
};

/** Detail panels: actions grouped by domain. */
export function partitionVisibleActions(e: VisibilityInput): PartitionedAdminActions {
	const all = visibleActionDefs(e);

	return {
		signature: all.filter((a) => SIGNATURE_PANEL_ACTIONS.has(a.action)),
		access: all.filter((a) => ACCESS_PANEL_ACTIONS.has(a.action)),
		actions: all.filter((a) => a.zone === 'actions'),
	};
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
