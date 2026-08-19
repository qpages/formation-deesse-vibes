import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../env', () => ({
	getEnv: () => ({
		YOUSIGN_API_BASE: 'https://api-sandbox.yousign.app/v3',
		SIGNATURE_PROVIDER: 'yousign',
	}),
	requireEnv: (key: string) => {
		if (key === 'YOUSIGN_API_KEY') return 'ys_test_key';
		throw new Error(`missing ${key}`);
	},
	FORMATION: { name: 'Formation Matrice Évolution', brand: 'Déesse Vibes' },
}));
vi.mock('../../e2e-providers', () => ({ e2eMockProviders: () => false }));

import { ndaSignatureRequestName, yousignAdapter } from './yousign';

describe('ndaSignatureRequestName', () => {
	it('libellé orienté apprenant, sans nom du signataire', () => {
		expect(ndaSignatureRequestName()).toBe(
			'Contrat de confidentialité — Formation Matrice Évolution',
		);
	});
});

describe('downloadSignedPdf', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('GET version=completed en binaire', async () => {
		const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(bytes, {
				status: 200,
				headers: { 'Content-Type': 'application/pdf' },
			}),
		);

		const file = await yousignAdapter.downloadSignedPdf('req-uuid');

		expect(file.contentType).toBe('application/pdf');
		expect(file.bytes).toEqual(bytes);
		expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(
			'https://api-sandbox.yousign.app/v3/signature_requests/req-uuid/documents/download?version=completed',
		);
		const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
		const headers = new Headers(init.headers);
		expect(headers.get('Authorization')).toBe('Bearer ys_test_key');
		expect(headers.get('Accept')).toBe('application/pdf, application/zip');
		expect(headers.get('Content-Type')).toBeNull();
	});

	it('erreur HTTP → throw avec le body', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('not done', { status: 400 }));

		await expect(yousignAdapter.downloadSignedPdf('req-uuid')).rejects.toThrow(
			'Yousign 400: not done',
		);
	});
});
