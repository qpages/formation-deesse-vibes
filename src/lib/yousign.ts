import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv, requireEnv } from './env';

export type YousignSignatureRequest = {
	id: string;
	status: string;
	signers?: Array<{
		id: string;
		status: string;
		signature_link?: string;
	}>;
};

export type ActivatedNda = {
	requestId: string;
	signerId: string;
	signatureLink?: string;
};

async function yousignFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const env = getEnv();
	const res = await fetch(`${env.YOUSIGN_API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${requireEnv('YOUSIGN_API_KEY')}`,
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

export async function getSignatureRequest(requestId: string) {
	return yousignFetch<YousignSignatureRequest>(`/signature_requests/${requestId}`);
}

/** Crée un brouillon Yousign depuis le template (sans activer / sans e-mail). */
export async function createNdaDraft(input: {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
}): Promise<{ requestId: string }> {
	const templateId = requireEnv('YOUSIGN_TEMPLATE_ID');
	const signerLabel = requireEnv('YOUSIGN_SIGNER_LABEL');

	if (!templateId || !signerLabel) {
		throw new Error('Yousign: templateId ou signerLabel non défini');
	}

	const created = await yousignFetch<YousignSignatureRequest>(`/signature_requests`, {
		method: 'POST',
		body: JSON.stringify({
			template_id: templateId,
			name: `NDA — ${input.firstName} ${input.lastName}`,
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

/**
 * Active une demande (ou la réutilise si déjà hors brouillon).
 * Idempotent : safe sur retry Inngest.
 */
export async function activateNdaRequest(requestId: string): Promise<ActivatedNda> {
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

export async function reactivateNda(requestId: string) {
	return yousignFetch<YousignSignatureRequest>(`/signature_requests/${requestId}/reactivate`, {
		method: 'POST',
		body: JSON.stringify({}),
	});
}

/** Lien de signature du signataire (même URL que dans l’e-mail Yousign). */
export type YousignSigner = {
	id: string;
	status: string;
	signature_link?: string | null;
	signature_link_expiration_date?: string | null;
	signed_at?: string | null;
};

/** Détail Signer — `signature_link` fiable uniquement ici, pas sur la Signature Request. */
export async function getSigner(requestId: string, signerId: string) {
	return yousignFetch<YousignSigner>(`/signature_requests/${requestId}/signers/${signerId}`);
}

export async function getSignatureLink(requestId: string, signerId: string) {
	const signer = await getSigner(requestId, signerId);
	return signer.signature_link ?? null;
}

export function verifyYousignSignature(rawBody: string, signatureHeader: string | null): boolean {
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

/** NDA pleinement provisionné (brouillon activé + IDs persistés). */
export function isNdaFullyProvisioned(enrollment: {
	yousignRequestId?: string | null;
	yousignSignerId?: string | null;
}): boolean {
	return Boolean(enrollment.yousignRequestId && enrollment.yousignSignerId);
}

/** Lien App Yousign vers une demande de signature. */
export function yousignAppUrl(requestId?: string | null): string | null {
	if (!requestId) return null;
	return `https://yousign.app/auth/workspace/requests/${requestId}`;
}
