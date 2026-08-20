import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEnrollmentById, downloadSignedPdf } = vi.hoisted(() => ({
	findEnrollmentById: vi.fn(),
	downloadSignedPdf: vi.fn(),
}));

vi.mock('../enrollment/queries', () => ({ findEnrollmentById }));
vi.mock('./providers', () => ({
	resolveSignatureProviderForEnrollment: () => ({ downloadSignedPdf }),
}));

import { getSignedNdaPdf, toSignedNdaResponse } from './nda-download';

function enrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		collectionStatus: 'paid',
		contractStatus: 'signed',
		ndaRequest: { externalRequestId: 'req_1', externalSignerId: 'sig_1', provider: 'yousign' },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getSignedNdaPdf', () => {
	it('inscription introuvable', async () => {
		findEnrollmentById.mockResolvedValue(null);

		await expect(getSignedNdaPdf('missing')).resolves.toEqual({
			ok: false,
			reason: 'enrollment_not_found',
		});
		expect(downloadSignedPdf).not.toHaveBeenCalled();
	});

	it('pas encore signé → not_signed', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ contractStatus: 'sent' }));

		await expect(getSignedNdaPdf('enr_1')).resolves.toEqual({
			ok: false,
			reason: 'not_signed',
		});
		expect(downloadSignedPdf).not.toHaveBeenCalled();
	});

	it('signé sans demande NDA → no_nda_request', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ ndaRequest: null }));

		await expect(getSignedNdaPdf('enr_1')).resolves.toEqual({
			ok: false,
			reason: 'no_nda_request',
		});
		expect(downloadSignedPdf).not.toHaveBeenCalled();
	});

	it('Yousign OK → PDF live, non persisté', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		downloadSignedPdf.mockResolvedValue({
			bytes,
			contentType: 'application/pdf',
		});

		await expect(getSignedNdaPdf('enr_1')).resolves.toEqual({
			ok: true,
			bytes,
			contentType: 'application/pdf',
			filename: 'contrat-confidentialite.pdf',
		});
		expect(downloadSignedPdf).toHaveBeenCalledWith('req_1');
	});

	it('plusieurs documents → zip', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		downloadSignedPdf.mockResolvedValue({
			bytes: new Uint8Array([0x50, 0x4b]),
			contentType: 'application/zip',
		});

		const result = await getSignedNdaPdf('enr_1');
		expect(result).toMatchObject({
			ok: true,
			filename: 'contrat-confidentialite.zip',
			contentType: 'application/zip',
		});
	});

	it('erreur provider → provider_error', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		downloadSignedPdf.mockRejectedValue(new Error('Yousign 400: not done'));

		await expect(getSignedNdaPdf('enr_1')).resolves.toEqual({
			ok: false,
			reason: 'provider_error',
			detail: 'Yousign 400: not done',
		});
	});
});

describe('toSignedNdaResponse', () => {
	it('succès → attachment PDF', async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const res = toSignedNdaResponse({
			ok: true,
			bytes,
			contentType: 'application/pdf',
			filename: 'contrat-confidentialite.pdf',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/pdf');
		expect(res.headers.get('Content-Disposition')).toBe(
			'attachment; filename="contrat-confidentialite.pdf"',
		);
		expect(res.headers.get('Cache-Control')).toBe('private, no-store');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
	});

	it('échec → JSON + reason', async () => {
		const res = toSignedNdaResponse({ ok: false, reason: 'not_signed' });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: 'Le contrat n’est pas encore signé.',
			reason: 'not_signed',
		});
	});
});
