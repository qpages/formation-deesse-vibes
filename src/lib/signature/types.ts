import type { EnqueueResult } from '../inngest/client';

export type SignedDocument = {
	bytes: Uint8Array;
	contentType: string;
};

export type ProvisionNdaDraftInput = {
	step: 'draft';
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
};

export type ProvisionNdaActivateInput = {
	step: 'activate';
	requestId: string;
};

export type ProvisionNdaInput = ProvisionNdaDraftInput | ProvisionNdaActivateInput;

export type ProvisionNdaDraftResult = {
	requestId: string;
};

export type ProvisionNdaActivateResult = {
	requestId: string;
	signerId: string;
	signatureLink?: string;
};

export type ProvisionNdaResult = ProvisionNdaDraftResult | ProvisionNdaActivateResult;

export type SignSurfaceInput = {
	requestId: string;
	signerId: string;
	email?: string;
};

export type SignSurface =
	| { kind: 'redirect'; url: string }
	| { kind: 'embed'; src: string; email: string };

export type SignatureCompletedEvent = {
	requestId: string;
	externalId?: string;
	occurredAt: Date;
};

export type SyncNdaStatusResult =
	| { ok: true; providerStatus: string; followUp: EnqueueResult }
	| {
			ok: false;
			reason:
				| 'enrollment_not_found'
				| 'no_nda_request'
				| 'unmapped_status'
				| 'draft_not_activated';
			detail?: string;
	  };

/** Port domaine NDA : provision, sync, surface, téléchargement, webhooks. */
export interface SignatureProvider {
	provisionNda(input: ProvisionNdaInput): Promise<ProvisionNdaResult>;
	syncStatus(enrollmentId: string): Promise<SyncNdaStatusResult>;
	getSignSurface(input: SignSurfaceInput): Promise<SignSurface | null>;
	downloadSignedPdf(requestId: string): Promise<SignedDocument>;
	verify(rawBody: string, signatureHeader: string | null): boolean;
	mapCompletedEvent(payload: unknown): SignatureCompletedEvent | null;
	/** YouSign uniquement — renvoi / réactivation d’un lien expiré. */
	reactivateNda?(requestId: string): Promise<unknown>;
}
