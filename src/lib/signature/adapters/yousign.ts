import { createHmac, timingSafeEqual } from 'node:crypto';
import { e2eMockProviders } from '../../e2e-providers';
import { FORMATION, getEnv, requireEnv } from '../../env';
import type {
	ProvisionNdaActivateResult,
	ProvisionNdaDraftResult,
	ProvisionNdaInput,
	ProvisionNdaResult,
	SignatureCompletedEvent,
	SignaturePort,
	SignatureWebhookAdapter,
	SignedDocument,
	SignSurfaceInput,
} from '../types';

export type YousignSignatureRequest = {
	id: string;
	status: string;
	signers?: Array<{
		id: string;
		status: string;
		signature_link?: string;
	}>;
};

export type YousignSigner = {
	id: string;
	status: string;
	signature_link?: string | null;
	signature_link_expiration_date?: string | null;
	signed_at?: string | null;
};

type YousignWebhookPayload = {
	event_name?: string;
	event_time?: string | number;
	data?: {
		signature_request?: {
			id?: string;
			external_id?: string;
		};
		signer?: {
			signature_request_id?: string;
		};
	};
};

function yousignAuthHeader(): { Authorization: string } {
	return { Authorization: `Bearer ${requireEnv('YOUSIGN_API_KEY')}` };
}

async function yousignFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const env = getEnv();
	const res = await fetch(`${env.YOUSIGN_API_BASE}${path}`, {
		...init,
		headers: {
			...yousignAuthHeader(),
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...(init?.headers ?? {}),
		},
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Yousign ${res.status}: ${text}`);
	}

	return res.json() as Promise<T>;
}

async function yousignFetchBinary(path: string): Promise<SignedDocument> {
	const env = getEnv();
	const res = await fetch(`${env.YOUSIGN_API_BASE}${path}`, {
		headers: {
			...yousignAuthHeader(),
			Accept: 'application/pdf, application/zip',
		},
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Yousign ${res.status}: ${text}`);
	}

	const bytes = new Uint8Array(await res.arrayBuffer());
	const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/pdf';
	return { bytes, contentType };
}

/** Titre affiché dans l’e-mail Yousign (pas le nom du signataire — redondant côté destinataire). */
export function ndaSignatureRequestName(): string {
	return `Contrat de confidentialité — ${FORMATION.name}`;
}

async function createNdaDraft(input: {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
}): Promise<ProvisionNdaDraftResult> {
	const templateId = requireEnv('YOUSIGN_TEMPLATE_ID');
	const signerLabel = requireEnv('YOUSIGN_SIGNER_LABEL');

	if (!templateId || !signerLabel) {
		throw new Error('Yousign: templateId ou signerLabel non défini');
	}

	const created = await yousignFetch<YousignSignatureRequest>(`/signature_requests`, {
		method: 'POST',
		body: JSON.stringify({
			template_id: templateId,
			name: ndaSignatureRequestName(),
			delivery_mode: 'email',
			timezone: 'Europe/Paris',
			external_id: input.enrollmentId,
			template_placeholders: {
				signers: [
					{
						label: signerLabel,
						info: {
							first_name: input.firstName,
							last_name: input.lastName,
							email: input.email,
							locale: 'fr',
						},
					},
				],
			},
		}),
	});

	return { requestId: created.id };
}

async function getSignatureRequest(requestId: string) {
	return yousignFetch<YousignSignatureRequest>(`/signature_requests/${requestId}`);
}

/**
 * Active une demande (ou la réutilise si déjà hors brouillon).
 * Idempotent : safe sur retry Inngest.
 */
async function activateNdaRequest(requestId: string): Promise<ProvisionNdaActivateResult> {
	const current = await getSignatureRequest(requestId);

	const activated =
		current.status === 'draft'
			? await yousignFetch<YousignSignatureRequest>(`/signature_requests/${requestId}/activate`, {
					method: 'POST',
				})
			: current;

	const signer = activated.signers?.[0];
	if (!signer) {
		throw new Error('Yousign: aucun signataire retourné');
	}

	return {
		requestId: activated.id,
		signerId: signer.id,
		signatureLink: signer.signature_link,
	};
}

async function getSigner(requestId: string, signerId: string) {
	return yousignFetch<YousignSigner>(`/signature_requests/${requestId}/signers/${signerId}`);
}

function verifyYousignSignature(rawBody: string, signatureHeader: string | null): boolean {
	const secret = requireEnv('YOUSIGN_WEBHOOK_SECRET');
	if (!signatureHeader) return false;

	const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
	const provided = signatureHeader.replace(/^sha256=/i, '').trim();

	try {
		const a = Buffer.from(expected, 'utf8');
		const b = Buffer.from(provided, 'utf8');
		return a.length === b.length && timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

function eventOccurredAt(payload: YousignWebhookPayload): Date {
	const raw = payload.event_time;
	if (typeof raw === 'number') {
		return new Date(raw > 1e12 ? raw : raw * 1000);
	}
	if (typeof raw === 'string' && raw.trim()) {
		const asNumber = Number(raw);
		if (!Number.isNaN(asNumber)) {
			return new Date(asNumber > 1e12 ? asNumber : asNumber * 1000);
		}
		const parsed = new Date(raw);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return new Date();
}

function mapCompletedEvent(payload: unknown): SignatureCompletedEvent | null {
	if (!payload || typeof payload !== 'object') return null;

	const body = payload as YousignWebhookPayload;
	if (body.event_name !== 'signature_request.done') return null;

	const requestId =
		body.data?.signature_request?.id ?? body.data?.signer?.signature_request_id ?? undefined;
	if (!requestId) return null;

	return {
		requestId,
		externalId: body.data?.signature_request?.external_id,
		occurredAt: eventOccurredAt(body),
	};
}

async function provisionNda(input: ProvisionNdaInput): Promise<ProvisionNdaResult> {
	if (input.step === 'draft') {
		return createNdaDraft(input);
	}
	return activateNdaRequest(input.requestId);
}

async function getSignSurface(input: SignSurfaceInput): Promise<string | null> {
	const signer = await getSigner(input.requestId, input.signerId);
	return signer.signature_link ?? null;
}

async function downloadSignedPdf(requestId: string): Promise<SignedDocument> {
	if (e2eMockProviders()) {
		return {
			bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
			contentType: 'application/pdf',
		};
	}

	return yousignFetchBinary(
		`/signature_requests/${requestId}/documents/download?version=completed`,
	);
}

/** Ops hors port Slice 1 — migrées vers nda_requests en Slice 2. */
export type YouSignAdapter = SignaturePort &
	SignatureWebhookAdapter & {
		getSignatureRequest(requestId: string): Promise<YousignSignatureRequest>;
		getSigner(requestId: string, signerId: string): Promise<YousignSigner>;
		reactivateNda(requestId: string): Promise<YousignSignatureRequest>;
	};

export const yousignAdapter: YouSignAdapter = {
	provisionNda,
	getSignSurface,
	downloadSignedPdf,
	verify: verifyYousignSignature,
	mapCompletedEvent,
	getSignatureRequest,
	getSigner,
	reactivateNda: (requestId: string) =>
		yousignFetch<YousignSignatureRequest>(`/signature_requests/${requestId}/reactivate`, {
			method: 'POST',
			body: JSON.stringify({}),
		}),
};
