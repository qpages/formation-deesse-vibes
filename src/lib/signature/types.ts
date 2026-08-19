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
};

export type SignatureCompletedEvent = {
	requestId: string;
	externalId?: string;
	occurredAt: Date;
};

export interface SignaturePort {
	provisionNda(input: ProvisionNdaInput): Promise<ProvisionNdaResult>;
	getSignSurface(input: SignSurfaceInput): Promise<string | null>;
	downloadSignedPdf(requestId: string): Promise<SignedDocument>;
}

export interface SignatureWebhookAdapter {
	verify(rawBody: string, signatureHeader: string | null): boolean;
	mapCompletedEvent(payload: unknown): SignatureCompletedEvent | null;
}

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

/** Provider-specific NDA status sync (admin / learner « j’ai signé »). */
export interface SignatureOps {
	sync(enrollmentId: string): Promise<SyncNdaStatusResult>;
}
