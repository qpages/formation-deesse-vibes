import { z } from 'zod';

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
			'Renvoyer un e-mail de relance à {name} et réactiver le lien de signature YouSign.',
		confirm: 'Envoyer la relance',
	},
	{
		action: 'recreate_nda',
		label: 'Recréer le NDA',
		zone: 'metier',
		eyebrow: 'Signature',
		title: 'Recréer le NDA',
		description:
			'Créer une nouvelle demande YouSign pour {name} et remplacer le lien actuel. L’ancien lien ne sera plus valide.',
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
			'Appeler l’API Teachizy pour renvoyer l’invitation à {name}. Si c’est la 1ère fois : pose le statut « accès envoyés ».',
		confirm: 'Renvoyer le lien',
	},
	{
		action: 'mark_refunded',
		label: 'Marquer remboursé',
		zone: 'metier',
		eyebrow: 'Paiement',
		title: 'Marquer comme remboursé',
		description:
			'Passer {name} en statut « remboursé » dans l’admin. Le remboursement Stripe et l’accès Teachizy restent à traiter manuellement.',
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
			'Passer {name} en statut « accès retiré ». Retirer l’accès Teachizy reste à faire manuellement dans Teachizy.',
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
			'Vérifier la session Stripe de {name} et passer le statut à « paiement confirmé » si le paiement est abouti (puis déclencher le NDA).',
		confirm: 'Synchroniser',
	},
	{
		action: 'sync_yousign',
		label: 'Sync statut Yousign',
		zone: 'recovery',
		eyebrow: 'Recovery',
		title: 'Synchroniser Yousign',
		description:
			'Lire le statut de la demande Yousign de {name} et aligner yousignStatus en base. Ne change pas le statut métier ni ne déclenche Teachizy.',
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
			'Envoyer l’event Inngest yousign/signature.done pour {name}. Utile si le job a raté après une signature déjà faite.',
		confirm: 'Déclencher Inngest',
	},
	{
		action: 'delete_nda',
		label: 'Effacer NDA (base)',
		zone: 'recovery',
		eyebrow: 'Recovery',
		title: 'Supprimer le NDA',
		description:
			'Effacer les IDs YouSign de {name} en base et revenir à « paiement confirmé » si besoin. Ne supprime pas la demande côté Yousign.',
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
