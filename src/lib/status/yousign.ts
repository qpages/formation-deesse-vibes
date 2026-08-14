import type {
	ContractStatus,
	YousignRequestStatus,
	YousignSignerStatus,
} from '../../generated/prisma/client';

export const YOUSIGN_FAILURE: ReadonlySet<YousignRequestStatus> = new Set([
	'expired',
	'declined',
	'canceled',
	'rejected',
	'error',
]);

/** Mappe un event_name Yousign vers un statut de demande. */
export function yousignStatusFromEvent(
	eventName: string,
): YousignRequestStatus | null {
	switch (eventName) {
		case 'signature_request.done':
			return 'done';
		case 'signature_request.expired':
			return 'expired';
		case 'signature_request.declined':
		case 'signer.declined':
			return 'declined';
		case 'signature_request.canceled':
		case 'signature_request.deleted':
			return 'canceled';
		case 'signature_request.rejected':
			return 'rejected';
		case 'signer.error':
		case 'signer.notification_delivery_failed':
			return 'error';
		default:
			return null;
	}
}

/** Mappe le `status` API d’une Signature Request vers l’enum Prisma. */
export function mapYousignApiStatus(
	apiStatus: string,
): YousignRequestStatus | null {
	switch (apiStatus.toLowerCase()) {
		case 'draft':
		case 'approval':
		case 'paused':
		case 'ongoing':
			return 'ongoing';
		case 'done':
			return 'done';
		case 'expired':
			return 'expired';
		case 'declined':
			return 'declined';
		case 'canceled':
		case 'deleted':
			return 'canceled';
		case 'rejected':
			return 'rejected';
		default:
			return null;
	}
}

/** Mappe le `status` API d’un Signer vers l’enum Prisma. */
export function mapYousignSignerApiStatus(
	apiStatus: string,
): YousignSignerStatus | null {
	switch (apiStatus.toLowerCase()) {
		case 'initiated':
			return 'initiated';
		case 'notified':
			return 'notified';
		case 'verified':
			return 'verified';
		case 'consent_given':
			return 'consent_given';
		case 'processing':
			return 'processing';
		case 'declined':
			return 'declined';
		case 'signed':
			return 'signed';
		case 'aborted':
			return 'aborted';
		case 'error':
			return 'error';
		default:
			return null;
	}
}

/** Aligne contractStatus métier sur le miroir request Yousign. */
export function contractStatusFromYousignRequest(
	yousignStatus: YousignRequestStatus,
): ContractStatus | undefined {
	switch (yousignStatus) {
		case 'ongoing':
			return 'sent';
		case 'done':
			return 'signed';
		case 'expired':
			return 'expired';
		case 'declined':
			return 'declined';
		case 'canceled':
		case 'rejected':
			return 'canceled';
		case 'error':
			return 'error';
		default:
			return undefined;
	}
}
