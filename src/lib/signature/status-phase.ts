import type { SignatureProvider } from '../../generated/prisma/client';

export type SignatureRequestPhase =
	'awaiting_signature' | 'signed' | 'expired' | 'declined' | 'canceled' | 'failed';

const PHASE_LABELS: Record<SignatureRequestPhase, string> = {
	awaiting_signature: 'En attente',
	signed: 'Signé',
	expired: 'Expiré',
	declined: 'Refusé',
	canceled: 'Annulé',
	failed: 'Erreur',
};

export function signatureRequestPhaseLabel(phase: SignatureRequestPhase): string {
	return PHASE_LABELS[phase];
}

/**
 * Converts provider vocabulary into the neutral phase used outside signature
 * adapters. Unknown values deliberately return null so callers can fall back
 * to the domain `contractStatus`.
 */
export function mapSignatureRequestPhase(
	provider: SignatureProvider | null | undefined,
	rawStatus: string | null | undefined,
): SignatureRequestPhase | null {
	if (!provider || !rawStatus) return null;

	switch (rawStatus.toLowerCase()) {
		case 'done':
		case 'signed':
		case 'completed':
			return 'signed';
		case 'expired':
			return 'expired';
		case 'declined':
		case 'rejected':
			return 'declined';
		case 'canceled':
		case 'cancelled':
		case 'deleted':
			return 'canceled';
		case 'error':
		case 'failed':
		case 'aborted':
			return 'failed';
		case 'draft':
		case 'approval':
		case 'paused':
		case 'ongoing':
		case 'pending':
		case 'awaiting':
		case 'initiated':
		case 'notified':
		case 'verified':
		case 'consent_given':
		case 'processing':
			return 'awaiting_signature';
		default:
			return null;
	}
}

export function isSignatureRequestFailure(
	phase: SignatureRequestPhase | null,
): phase is Exclude<SignatureRequestPhase, 'awaiting_signature' | 'signed'> {
	return Boolean(phase && phase !== 'awaiting_signature' && phase !== 'signed');
}
