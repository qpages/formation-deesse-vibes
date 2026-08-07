import type { AdminEnrollmentDetail } from './enrollments';
import type { AdminPaymentSummary } from './payments';
import { formatMoney } from '../payment-plans';
import { COLLECTION_STATUS_LABELS, CONTRACT_STATUS_LABELS, ACCESS_STATUS_LABELS } from '../status';

export type PipelineStageCard = {
	key: 'paiement' | 'signature' | 'acces';
	title: string;
	label: string;
	tone: AdminEnrollmentDetail['pipeline']['paiement']['tone'];
	hint: string;
	href: string;
};

/** Enriched pipeline tiles for the detail hybrid layout. */
export function buildPipelineStageCards(
	detail: AdminEnrollmentDetail,
	paymentSummary: AdminPaymentSummary,
): PipelineStageCard[] {
	const collected = formatMoney(paymentSummary.collectedAmountCents);
	const total =
		paymentSummary.totalAmountCents != null
			? formatMoney(paymentSummary.totalAmountCents)
			: null;
	const moneyHint = total ? `${collected} / ${total}` : collected;

	let paiementHint = moneyHint;
	if (detail.collectionStatus === 'pending') {
		paiementHint = `${moneyHint} · sync Stripe pour confirmer`;
	} else if (detail.collectionStatus === 'past_due') {
		paiementHint = `${moneyHint} · échéance en retard`;
	} else if (detail.collectionStatus === 'paid' || detail.collectionStatus === 'current') {
		paiementHint = `${moneyHint} · ${COLLECTION_STATUS_LABELS[detail.collectionStatus]}`;
	}

	let signatureHint: string;
	if (detail.collectionStatus === 'pending' || detail.collectionStatus === 'canceled') {
		signatureHint = 'Bloqué — paiement requis';
	} else if (detail.contractStatus === 'signed') {
		signatureHint = 'NDA signé';
	} else if (detail.contractStatus === 'sent') {
		signatureHint = 'En attente de signature';
	} else if (detail.yousignRequestId) {
		signatureHint = `Yousign · ${CONTRACT_STATUS_LABELS[detail.contractStatus]}`;
	} else {
		signatureHint = 'NDA pas encore créé';
	}

	let accesHint: string;
	if (detail.contractStatus !== 'signed') {
		accesHint = 'Bloqué — signature requise';
	} else if (detail.accessStatus === 'active') {
		accesHint = 'Teachizy actif';
	} else if (detail.accessStatus === 'pending') {
		accesHint = 'Provisionnement en cours';
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
		},
		{
			key: 'signature',
			title: 'Signature',
			label: detail.pipeline.signature.label,
			tone: detail.pipeline.signature.tone,
			hint: signatureHint,
			href: '#next-action',
		},
		{
			key: 'acces',
			title: 'Accès',
			label: detail.pipeline.acces.label,
			tone: detail.pipeline.acces.tone,
			hint: accesHint,
			href: '#next-action',
		},
	];
}
