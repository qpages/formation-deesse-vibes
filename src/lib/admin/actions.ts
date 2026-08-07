import { z } from 'zod';
import type {
	AccessStatus,
	CollectionStatus,
	ContractStatus,
	Enrollment,
} from '../../generated/prisma/client';
import { isAwaitingNda, isPaidEnough } from '../enrollment-gates';

export const adminActionZones = ['metier', 'recovery'] as const;
export type AdminActionZone = (typeof adminActionZones)[number];

export const adminActionKeys = [
	'resend_nda',
	'retrigger_teachizy',
	'sync_payment',
	'sync_yousign',
	'recreate_nda',
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
}

/** Descriptions use `{name}` — remplacé côté client. */
export const ADMIN_ACTIONS: AdminActionDef[] = [
	{
		action: 'resend_nda',
		label: 'Renvoyer le lien Yousign',
		zone: 'metier',
		eyebrow: 'Signature',
		title: 'Renvoyer le lien Yousign',
		description:
			'Renvoyer à {name} le même lien de signature Yousign (réactivation). L’ancien lien reste valide.',
		confirm: 'Renvoyer le lien',
	},
	{
		action: 'retrigger_teachizy',
		label: 'Inviter à la formation',
		zone: 'metier',
		eyebrow: 'Accès',
		title: 'Inviter à la formation',
		description:
			'Envoyer / réactiver l’invitation Teachizy pour {name} (selon la politique d’accès).',
		confirm: 'Inviter',
	},
	{
		action: 'sync_payment',
		label: 'Sync paiement Stripe',
		zone: 'recovery',
		eyebrow: 'Réparation',
		title: 'Synchroniser le paiement',
		description:
			'Lire la session Stripe de {name}, recalculer la collection, puis réévaluer l’accès. Peut enchaîner la création NDA si éligible.',
		confirm: 'Synchroniser',
	},
	{
		action: 'sync_yousign',
		label: 'Sync statut Yousign',
		zone: 'recovery',
		eyebrow: 'Réparation',
		title: 'Synchroniser Yousign',
		description:
			'Lire le statut Yousign de {name} et aligner contractStatus / yousignStatus en base (sync lecture).',
		confirm: 'Synchroniser',
	},
	{
		action: 'recreate_nda',
		label: 'Recréer un lien Yousign',
		zone: 'recovery',
		eyebrow: 'Réparation',
		title: 'Recréer un lien Yousign',
		description:
			'Créer une nouvelle demande Yousign pour {name}. L’ancien lien ne sera plus valide.',
		confirm: 'Recréer le lien',
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
	| 'collectionStatus'
	| 'contractStatus'
	| 'accessStatus'
	| 'yousignRequestId'
	| 'stripeCheckoutSessionId'
>;

/** Miroir des gates API (sync). L’API reste source de vérité (cooldown relance, etc.). */
export function isActionVisible(action: AdminActionKey, e: VisibilityInput): boolean {
	const paidEnough = isPaidEnough(e.collectionStatus);

	switch (action) {
		case 'resend_nda':
			return isAwaitingNda(e) && Boolean(e.yousignRequestId);
		case 'recreate_nda':
			return paidEnough && e.contractStatus !== 'signed';
		case 'retrigger_teachizy':
			return e.accessStatus !== 'revoked' && e.contractStatus === 'signed';
		case 'sync_payment':
			return Boolean(e.stripeCheckoutSessionId);
		case 'sync_yousign':
			return Boolean(e.yousignRequestId);
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

function actionDef(action: AdminActionKey): AdminActionDef {
	const def = ADMIN_ACTIONS.find((a) => a.action === action);
	if (!def) throw new Error(`Unknown admin action: ${action}`);
	return def;
}

/** Pipeline-first next step — métier before réparation. */
export function recommendedAction(e: VisibilityInput): AdminActionDef | null {
	const allowed = new Set(visibleActions(e));
	const pick = (key: AdminActionKey) => (allowed.has(key) ? actionDef(key) : null);

	if (
		e.collectionStatus === 'pending' ||
		e.collectionStatus === 'past_due' ||
		e.collectionStatus === 'canceled'
	) {
		const sync = pick('sync_payment');
		if (sync) return sync;
	}

	if (e.contractStatus === 'sent' || e.contractStatus === 'pending') {
		const resend = pick('resend_nda');
		if (resend) return resend;
		const yousign = pick('sync_yousign');
		if (yousign) return yousign;
		const sync = pick('sync_payment');
		if (sync) return sync;
	}

	if (e.contractStatus === 'signed' && e.accessStatus !== 'active') {
		const invite = pick('retrigger_teachizy');
		if (invite) return invite;
	}

	if (e.accessStatus === 'suspended') {
		const invite = pick('retrigger_teachizy');
		if (invite) return invite;
	}

	const fallback: AdminActionKey[] = [
		'sync_payment',
		'sync_yousign',
		'resend_nda',
		'retrigger_teachizy',
	];
	for (const key of fallback) {
		const hit = pick(key);
		if (hit) return hit;
	}

	return null;
}

export function recommendedActionReason(
	e: VisibilityInput,
	action: AdminActionKey,
): string {
	switch (action) {
		case 'sync_payment':
			if (e.collectionStatus === 'past_due') {
				return 'Impayé détecté — resynchronisez Stripe pour aligner le dossier.';
			}
			if (e.collectionStatus === 'canceled') {
				return 'Paiement annulé côté collection — vérifiez l’état Stripe.';
			}
			if (e.contractStatus === 'pending' || e.contractStatus === 'sent') {
				return 'Signature bloquée — synchronisez Stripe pour débloquer / créer le lien Yousign.';
			}
			return 'Paiement en attente — synchronisez Stripe pour débloquer la signature.';
		case 'resend_nda':
			return 'Signature en attente — renvoyez le lien Yousign.';
		case 'sync_yousign':
			return 'Statut signature à vérifier — synchronisez Yousign.';
		case 'retrigger_teachizy':
			return 'NDA signé — invitez à la formation.';
		default:
			return 'Prochaine action recommandée pour ce dossier.';
	}
}

export type PartitionedAdminActions = {
	recommended: AdminActionDef | null;
	reason: string | null;
	secondary: AdminActionDef[];
};

/** Detail panel: recommended CTA + other visible actions. */
export function partitionVisibleActions(e: VisibilityInput): PartitionedAdminActions {
	const recommended = recommendedAction(e);
	const secondary = visibleActionDefs(e).filter(
		(a) => a.action !== recommended?.action,
	);
	return {
		recommended,
		reason: recommended ? recommendedActionReason(e, recommended.action) : null,
		secondary,
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
