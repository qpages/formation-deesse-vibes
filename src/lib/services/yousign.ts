import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv, requireEnv } from '../env';

export type YousignSignatureRequest = {
	id: string;
	status: string;
	signers?: Array<{
		id: string;
		status: string;
		signature_link?: string;
	}>;
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

/** Crée une demande de signature depuis le modèle NDA (une seule par inscription). */
export async function createNdaFromTemplate(input: {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
}): Promise<{ requestId: string; signerId: string; signatureLink?: string }> {
	const templateId = requireEnv('YOUSIGN_TEMPLATE_ID');

	const created = await yousignFetch<YousignSignatureRequest>(
		`/signature_requests/from_template`,
		{
			method: 'POST',
			body: JSON.stringify({
				template_id: templateId,
				name: `NDA — ${input.firstName} ${input.lastName}`,
				delivery_mode: 'email',
				timezone: 'Europe/Paris',
				external_id: input.enrollmentId,
				signers: [
					{
						info: {
							first_name: input.firstName,
							last_name: input.lastName,
							email: input.email,
							locale: 'fr',
						},
						signature_level: 'electronic_signature',
						signature_authentication_mode: 'otp_email',
					},
				],
			}),
		},
	);

	const activated = await yousignFetch<YousignSignatureRequest>(
		`/signature_requests/${created.id}/activate`,
		{ method: 'POST' },
	);

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

export async function getSignatureLink(requestId: string, signerId: string) {
	const req = await yousignFetch<YousignSignatureRequest>(`/signature_requests/${requestId}`);
	const signer = req.signers?.find((s) => s.id === signerId) ?? req.signers?.[0];
	return signer?.signature_link ?? null;
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
