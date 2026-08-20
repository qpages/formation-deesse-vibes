import type { AdminEnrollmentDetail } from './enrollments';
import type { AdminPaymentSummary } from './payments';
import { formatMoney } from '../payment-plans';
import {
	resolveExternalRequestId,
	resolveExternalSignerId,
} from '../signature/nda-request';
import type { BadgeTone } from '../status';
import { COLLECTION_STATUS_LABELS, CONTRACT_STATUS_LABELS, ACCESS_STATUS_LABELS } from '../status';

export type PipelineStageKey = 'paiement' | 'signature' | 'acces';

export type PipelineStageCard = {
	key: PipelineStageKey;
	title: string;
	label: string;
	tone: AdminEnrollmentDetail['pipeline']['paiement']['tone'];
	hint: string;
	href: string;
	/** Étape qui bloque la suite du parcours. */
	blocking: boolean;
};

export type EnrollmentHeadline = {
	label: string;
	tone: BadgeTone;
};

type BottleneckInput = Pick<
	AdminEnrollmentDetail,
	'collectionStatus' | 'contractStatus' | 'accessStatus' | 'ndaRequest'
>;

/** Première étape qui bloque paiement → signature → accès. null = dossier fluide. */
export function resolvePipelineBottleneck(detail: BottleneckInput): PipelineStageKey | null {
	if (
		detail.collectionStatus === 'pending' ||
		detail.collectionStatus === 'past_due' ||
		detail.collectionStatus === 'canceled' ||
		detail.collectionStatus === 'refunded'
	) {
		return 'paiement';
	}

	if (detail.contractStatus !== 'signed') {
		return 'signature';
	}

	if (detail.accessStatus !== 'active') {
		return 'acces';
	}

	return null;
}

/** Ligne d’état sous le nom (header détail). */
export function enrollmentHeadline(detail: BottleneckInput): EnrollmentHeadline {
	const bottleneck = resolvePipelineBottleneck(detail);

	if (!bottleneck) {
		return { label: 'Dossier à jour', tone: 'success' };
	}

	if (bottleneck === 'paiement') {
		if (detail.collectionStatus === 'past_due') {
			return { label: 'Bloqué · impayé', tone: 'action' };
		}
		if (detail.collectionStatus === 'canceled' || detail.collectionStatus === 'refunded') {
			return {
				label: `Bloqué · ${COLLECTION_STATUS_LABELS[detail.collectionStatus].toLowerCase()}`,
				tone: 'neutral',
			};
		}
		return { label: 'Bloqué · paiement', tone: 'action' };
	}

	if (bottleneck === 'signature') {
		if (detail.contractStatus === 'pending' && detail.ndaRequest?.lastError) {
			return { label: 'Signature en erreur', tone: 'action' };
		}

		switch (detail.contractStatus) {
			case 'pending':
				return { label: 'NDA à envoyer', tone: 'progress' };
			case 'sent':
				return { label: 'NDA à signer', tone: 'action' };
			case 'expired':
				return { label: 'NDA expiré', tone: 'action' };
			case 'error':
				return { label: 'Signature en erreur', tone: 'action' };
			case 'declined':
				return { label: 'NDA refusé', tone: 'action' };
			case 'canceled':
				return { label: 'NDA annulé', tone: 'neutral' };
			case 'signed':
				return { label: 'NDA signé', tone: 'success' };
		}
	}

	if (detail.accessStatus === 'suspended') {
		return { label: 'Accès suspendu', tone: 'action' };
	}
	if (detail.accessStatus === 'pending') {
		return { label: 'Accès en cours', tone: 'progress' };
	}

	return {
		label: `Accès · ${ACCESS_STATUS_LABELS[detail.accessStatus].toLowerCase()}`,
		tone: 'progress',
	};
}

export type SignatureDiagnosticLevel = 'error' | 'warn' | 'info';

export type SignatureDiagnostic = {
	level: SignatureDiagnosticLevel;
	/** Fait brut : soit l'erreur provider verbatim, soit l'état constaté. */
	title: string;
	/** Une seule action concrète, quand elle apporte de l'info. Optionnel. */
	action?: string;
};

type SignatureDiagnosticInput = Pick<
	AdminEnrollmentDetail,
	| 'collectionStatus'
	| 'contractStatus'
	| 'ndaDeliveryFailedAt'
	| 'ndaRequest'
>;

/**
 * Diagnostic signature = faits, pas de narratif.
 * Priorité absolue à l'erreur provider brute si on l'a captée ; sinon on nomme
 * l'état constaté et l'action qui ira chercher le vrai motif côté provider.
 * `null` = rien à signaler (signé, ou signature pas encore due car impayé).
 */
export function signatureDiagnostic(detail: SignatureDiagnosticInput): SignatureDiagnostic | null {
	if (detail.contractStatus === 'signed') return null;

	// 1. Erreur réelle remontée par un job / webhook / sync → affichée verbatim.
	if (detail.ndaRequest?.lastError) {
		return { level: 'error', title: `Signature : ${detail.ndaRequest.lastError}` };
	}

	const paid =
		detail.collectionStatus !== 'pending' &&
		detail.collectionStatus !== 'canceled' &&
		detail.collectionStatus !== 'refunded';

	// Signature pas encore due : pas un problème à signaler ici.
	if (!paid) return null;

	const requestId = resolveExternalRequestId(detail);
	const signerId = resolveExternalSignerId(detail);

	// 2. Pas d'erreur captée : on décrit l'état et on pointe l'action qui révèle le motif.
	if (!requestId) {
		return {
			level: 'warn',
			title: 'Aucune demande de signature créée.',
			action: '« Recréer un lien de signature » pour lancer la création.',
		};
	}

	if (!signerId && detail.contractStatus === 'pending') {
		return {
			level: 'warn',
			title: 'Demande de signature présente mais sans signataire, et aucune erreur enregistrée.',
			action:
				'« Sync NDA » interroge le provider en direct et affiche le statut/motif réel ici.',
		};
	}

	if (detail.contractStatus === 'sent' && detail.ndaDeliveryFailedAt) {
		return { level: 'error', title: 'E-mail de signature en échec de livraison.' };
	}

	return null;
}

function formatShortDate(value: Date | null | undefined): string | null {
	if (!value) return null;
	return value.toLocaleDateString('fr-FR', {
		day: 'numeric',
		month: 'short',
		timeZone: 'Europe/Paris',
	});
}

function formatShortDateTime(value: Date | null | undefined): string | null {
	if (!value) return null;
	return value.toLocaleString('fr-FR', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	});
}

function buildSignatureHint(detail: AdminEnrollmentDetail): string {
	if (detail.collectionStatus === 'pending' || detail.collectionStatus === 'canceled') {
		return 'Bloqué — paiement requis';
	}

	if (detail.ndaRequest?.lastError) {
		return 'Échec signature · recréer le lien';
	}

	if (detail.contractStatus === 'signed') {
		const when = formatShortDateTime(detail.ndaSignedAt);
		return when ? `NDA signé le ${when}` : 'NDA signé';
	}

	if (detail.contractStatus === 'sent') {
		if (detail.ndaDeliveryFailedAt) {
			return 'E-mail en échec · renvoyer';
		}
		if (detail.ndaLinkOpenedAt) {
			return 'Lien ouvert · pas encore signé';
		}
		if (detail.ndaNotifiedAt || detail.ndaRequest?.providerStatus === 'notified') {
			const expires = formatShortDate(detail.signatureLinkExpiresAt);
			return expires ? `E-mail envoyé · expire le ${expires}` : 'E-mail envoyé';
		}
		return 'En attente de signature';
	}

	if (resolveExternalRequestId(detail)) {
		return `Signature · ${CONTRACT_STATUS_LABELS[detail.contractStatus]}`;
	}

	return 'NDA pas encore créé';
}

/** Enriched pipeline tiles for the detail hybrid layout. */
export function buildPipelineStageCards(
	detail: AdminEnrollmentDetail,
	paymentSummary: AdminPaymentSummary,
): PipelineStageCard[] {
	const bottleneck = resolvePipelineBottleneck(detail);
	const collected = formatMoney(paymentSummary.collectedAmountCents);
	const total =
		paymentSummary.totalAmountCents != null ? formatMoney(paymentSummary.totalAmountCents) : null;
	const moneyHint = total ? `${collected} / ${total}` : collected;

	let paiementHint = moneyHint;
	if (detail.collectionStatus === 'pending') {
		paiementHint = `${moneyHint} · sync Stripe pour confirmer`;
	} else if (detail.collectionStatus === 'past_due') {
		paiementHint = `${moneyHint} · échéance en retard`;
	} else if (detail.collectionStatus === 'paid' || detail.collectionStatus === 'current') {
		paiementHint = `${moneyHint} · ${COLLECTION_STATUS_LABELS[detail.collectionStatus]}`;
	}

	const signatureHint = buildSignatureHint(detail);

	let accesHint: string;
	if (detail.contractStatus !== 'signed') {
		accesHint = 'Bloqué — signature requise';
	} else if (detail.accessStatus === 'active') {
		accesHint = 'Teachizy actif';
	} else if (detail.accessStatus === 'pending') {
		accesHint = 'Invitation Teachizy en cours';
	} else if (detail.accessStatus === 'suspended') {
		accesHint = 'Suspendu — renvoyer Teachizy si éligible';
	} else {
		accesHint = ACCESS_STATUS_LABELS[detail.accessStatus];
	}

	return [
		{
			key: 'paiement',
			title: 'Paiement',
			label: detail.pipeline.paiement.label,
			tone: detail.pipeline.paiement.tone,
			hint: paiementHint,
			href: '#paiements',
			blocking: bottleneck === 'paiement',
		},
		{
			key: 'signature',
			title: 'Signature',
			label: detail.pipeline.signature.label,
			tone: detail.pipeline.signature.tone,
			hint: signatureHint,
			href: '#signature',
			blocking: bottleneck === 'signature',
		},
		{
			key: 'acces',
			title: 'Teachizy',
			label: detail.pipeline.acces.label,
			tone: detail.pipeline.acces.tone,
			hint: accesHint,
			href: '#acces',
			blocking: bottleneck === 'acces',
		},
	];
}
