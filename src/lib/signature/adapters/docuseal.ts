import { createHmac, timingSafeEqual } from 'node:crypto';
import { e2eMockProviders } from '../../e2e-providers';
import { getEnv, requireEnv } from '../../env';
import { resolveSignatureConfig } from '../config';
import type {
	ProvisionNdaActivateResult,
	ProvisionNdaDraftResult,
	ProvisionNdaInput,
	ProvisionNdaResult,
	SignatureCompletedEvent,
	SignatureProvider,
	SignedDocument,
	SignSurface,
	SignSurfaceInput,
} from '../types';
import { syncDocusealNda } from './docuseal-sync';
import type { DocusealWebhookPayload } from './docuseal-types';

export type DocusealSubmissionEvent = {
	id?: number;
	submitter_id?: number;
	event_type: string;
	event_timestamp: string;
};

export type DocusealSubmitter = {
	id: number;
	submission_id: number;
	email: string;
	embed_src?: string;
	slug?: string;
	status?: string;
	completed_at?: string | null;
	submission_events?: DocusealSubmissionEvent[];
};

export type DocusealSubmission = {
	id: number;
	status: string;
	external_id?: string | null;
	combined_document_url?: string | null;
	documents?: Array<{ name: string; url: string }>;
	submitters?: DocusealSubmitter[];
	completed_at?: string | null;
};

function docusealAuthHeader(): { 'X-Auth-Token': string } {
	return { 'X-Auth-Token': requireEnv('DOCUSEAL_API_KEY') };
}

async function docusealFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const env = getEnv();
	const res = await fetch(`${env.DOCUSEAL_API_BASE}${path}`, {
		...init,
		headers: {
			...docusealAuthHeader(),
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...(init?.headers ?? {}),
		},
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`DocuSeal ${res.status}: ${text}`);
	}

	return res.json() as Promise<T>;
}

async function docusealFetchBinary(url: string): Promise<SignedDocument> {
	const res = await fetch(url, { headers: docusealAuthHeader() });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`DocuSeal download ${res.status}: ${text}`);
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/pdf';
	return { bytes, contentType };
}

function templateId(): number {
	const raw = requireEnv('DOCUSEAL_TEMPLATE_ID');
	const id = Number(raw);
	if (!Number.isFinite(id)) {
		throw new Error('DocuSeal: DOCUSEAL_TEMPLATE_ID must be a numeric template id');
	}
	return id;
}

function docusealSigningHost(): string {
	const apiBase = getEnv().DOCUSEAL_API_BASE;
	if (apiBase.includes('.com')) return 'https://docuseal.com';
	return 'https://docuseal.eu';
}

/** POST /submissions returns embed_src; GET often omits it but includes slug. */
function submitterSigningUrl(submitter: DocusealSubmitter): string | undefined {
	if (submitter.embed_src) return submitter.embed_src;
	if (submitter.slug) return `${docusealSigningHost()}/s/${submitter.slug}`;
	return undefined;
}

async function createSubmission(input: {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
}): Promise<ProvisionNdaActivateResult> {
	const { mode } = resolveSignatureConfig();
	const sendEmail = mode === 'redirect';

	const submitters = await docusealFetch<DocusealSubmitter[]>('/submissions', {
		method: 'POST',
		body: JSON.stringify({
			template_id: templateId(),
			send_email: sendEmail,
			external_id: input.enrollmentId,
			submitters: [
				{
					email: input.email,
					name: `${input.firstName} ${input.lastName}`.trim(),
					send_email: sendEmail,
					external_id: input.enrollmentId,
				},
			],
		}),
	});

	const submitter = submitters[0];
	if (!submitter?.submission_id || !submitter.id) {
		throw new Error('DocuSeal: aucun signataire retourné');
	}

	return {
		requestId: String(submitter.submission_id),
		signerId: String(submitter.id),
		signatureLink: submitterSigningUrl(submitter),
	};
}

async function getSubmission(requestId: string): Promise<DocusealSubmission> {
	if (e2eMockProviders()) {
		const completed = requestId.startsWith('e2e-completed-');
		return {
			id: 1,
			status: completed ? 'completed' : 'pending',
			completed_at: completed ? new Date().toISOString() : null,
			submitters: [
				{
					id: 1,
					submission_id: 1,
					email: 'e2e@example.test',
					slug: 'e2e-mock-slug',
				},
			],
		};
	}
	return docusealFetch<DocusealSubmission>(`/submissions/${requestId}`);
}

async function getSubmitter(signerId: string): Promise<DocusealSubmitter> {
	if (e2eMockProviders()) {
		return {
			id: Number(signerId.replace(/\D/g, '')) || 1,
			submission_id: 1,
			email: 'e2e@example.test',
			slug: `e2e-slug-${signerId}`,
			status: 'completed',
			completed_at: new Date().toISOString(),
		};
	}
	return docusealFetch<DocusealSubmitter>(`/submitters/${signerId}`);
}

/** Submission submitters often omit embed_src; GET /submitters/{id} is the reliable fallback. */
async function resolveSigningUrl(
	submission: DocusealSubmission,
	signerId: string,
): Promise<{ url?: string; submitter: DocusealSubmitter }> {
	const fromSubmission =
		submission.submitters?.find((s) => String(s.id) === signerId) ?? submission.submitters?.[0];

	const urlFromSubmission = fromSubmission ? submitterSigningUrl(fromSubmission) : undefined;
	if (urlFromSubmission && fromSubmission) {
		return { url: urlFromSubmission, submitter: fromSubmission };
	}

	const remote = await getSubmitter(signerId);
	return { url: submitterSigningUrl(remote), submitter: remote };
}

function verifyDocusealSignature(rawBody: string, signatureHeader: string | null): boolean {
	const secret = requireEnv('DOCUSEAL_WEBHOOK_SECRET');
	if (!signatureHeader) return false;

	const [timestamp, signature] = signatureHeader.split('.', 2);
	if (!timestamp || !signature) return false;

	if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

	const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

	try {
		const a = Buffer.from(expected, 'utf8');
		const b = Buffer.from(signature, 'utf8');
		return a.length === b.length && timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

function docusealOccurredAt(payload: DocusealWebhookPayload): Date {
	const raw =
		payload.data?.completed_at ?? payload.data?.submission?.completed_at ?? payload.timestamp;
	if (typeof raw === 'string' && raw.trim()) {
		const parsed = new Date(raw);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return new Date();
}

export function mapDocusealCompletedEvent(payload: unknown): SignatureCompletedEvent | null {
	if (!payload || typeof payload !== 'object') return null;

	const body = payload as DocusealWebhookPayload;
	const eventType = body.event_type;
	if (eventType !== 'form.completed' && eventType !== 'submission.completed') return null;

	const requestId =
		eventType === 'submission.completed'
			? String(body.data?.id ?? '').trim()
			: String(body.data?.submission?.id ?? body.data?.submission_id ?? '').trim();
	if (!requestId) return null;

	const externalId =
		body.data?.external_id ??
		body.data?.submission?.external_id ??
		body.data?.submitters?.[0]?.external_id ??
		undefined;

	return {
		requestId,
		externalId: externalId ?? undefined,
		occurredAt: docusealOccurredAt(body),
	};
}

async function provisionNda(input: ProvisionNdaInput): Promise<ProvisionNdaResult> {
	if (input.step === 'draft') {
		const created = await createSubmission(input);
		return { requestId: created.requestId } satisfies ProvisionNdaDraftResult;
	}

	const submission = await getSubmission(input.requestId);
	const submitter = submission.submitters?.[0];
	if (!submitter) {
		throw new Error('DocuSeal: signataire introuvable sur la soumission');
	}

	const { url, submitter: resolved } = await resolveSigningUrl(submission, String(submitter.id));

	return {
		requestId: String(submission.id),
		signerId: String(resolved.id),
		signatureLink: url,
	};
}

async function getSignSurface(input: SignSurfaceInput): Promise<SignSurface | null> {
	if (e2eMockProviders()) {
		const url = `https://docuseal.eu/s/e2e-${encodeURIComponent(input.requestId)}`;
		if (input.requestId.startsWith('e2e-redirect-')) {
			return { kind: 'redirect', url };
		}
		const { mode } = resolveSignatureConfig();
		if (mode === 'redirect') {
			return { kind: 'redirect', url };
		}
		if (!input.email) return null;
		return { kind: 'embed', provider: 'docuseal', src: url, email: input.email };
	}

	const submission = await getSubmission(input.requestId);
	const { url } = await resolveSigningUrl(submission, input.signerId);
	if (!url) return null;

	const { mode } = resolveSignatureConfig();
	if (mode === 'redirect') {
		return { kind: 'redirect', url };
	}

	if (!input.email) return null;
	return { kind: 'embed', provider: 'docuseal', src: url, email: input.email };
}

async function downloadSignedPdf(requestId: string): Promise<SignedDocument> {
	if (e2eMockProviders()) {
		return {
			bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
			contentType: 'application/pdf',
		};
	}

	const submission = await getSubmission(requestId);
	const url = submission.combined_document_url ?? submission.documents?.[0]?.url ?? null;
	if (!url) {
		throw new Error('DocuSeal: document signé indisponible');
	}

	return docusealFetchBinary(url);
}

export type DocusealAdapter = SignatureProvider & {
	getSubmission(requestId: string): Promise<DocusealSubmission>;
	getSubmitter(signerId: string): Promise<DocusealSubmitter>;
};

export const docusealAdapter: DocusealAdapter = {
	provisionNda,
	getSignSurface,
	downloadSignedPdf,
	verify: verifyDocusealSignature,
	mapCompletedEvent: mapDocusealCompletedEvent,
	getSubmission,
	getSubmitter,
	syncStatus: (enrollmentId) => syncDocusealNda(enrollmentId, { getSubmission, getSubmitter }),
};
