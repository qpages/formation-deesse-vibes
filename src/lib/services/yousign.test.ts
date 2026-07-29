import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, update } = vi.hoisted(() => ({
	findUnique: vi.fn(),
	update: vi.fn(),
}));

vi.mock('../env', () => ({
	getEnv: () => ({
		YOUSIGN_API_BASE: 'https://api-sandbox.yousign.app/v3',
	}),
	requireEnv: (key: string) => {
		const values: Record<string, string> = {
			YOUSIGN_API_KEY: 'ys_test',
			YOUSIGN_TEMPLATE_ID: 'tpl_test',
			YOUSIGN_WEBHOOK_SECRET: 'secret',
			YOUSIGN_SIGNER_LABEL: 'acheteur',
		};
		const value = values[key];
		if (!value) throw new Error(`Missing required environment variable: ${key}`);
		return value;
	},
}));

vi.mock('../db', () => ({
	getPrisma: () => ({
		enrollment: { findUnique, update },
	}),
}));

import {
	activateNdaRequest,
	createNdaDraft,
	isNdaFullyProvisioned,
	syncYousignStatus,
} from './yousign';

describe('isNdaFullyProvisioned', () => {
	it('exige requestId et signerId', () => {
		expect(isNdaFullyProvisioned({})).toBe(false);
		expect(isNdaFullyProvisioned({ yousignRequestId: 'req_1' })).toBe(false);
		expect(isNdaFullyProvisioned({ yousignSignerId: 'sig_1' })).toBe(false);
		expect(
			isNdaFullyProvisioned({ yousignRequestId: 'req_1', yousignSignerId: 'sig_1' }),
		).toBe(true);
	});
});

describe('activateNdaRequest', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('active un brouillon', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(
				Response.json({
					id: 'req_1',
					status: 'draft',
					signers: [{ id: 'sig_draft', status: 'initiated' }],
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					id: 'req_1',
					status: 'ongoing',
					signers: [
						{
							id: 'sig_1',
							status: 'notified',
							signature_link: 'https://sign.example/1',
						},
					],
				}),
			);

		const result = await activateNdaRequest('req_1');

		expect(result).toEqual({
			requestId: 'req_1',
			signerId: 'sig_1',
			signatureLink: 'https://sign.example/1',
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[1][0])).toContain('/activate');
	});

	it('ne ré-active pas une demande déjà ongoing (retry safe)', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValueOnce(
			Response.json({
				id: 'req_1',
				status: 'ongoing',
				signers: [
					{
						id: 'sig_1',
						status: 'notified',
						signature_link: 'https://sign.example/1',
					},
				],
			}),
		);

		const result = await activateNdaRequest('req_1');

		expect(result.signerId).toBe('sig_1');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).not.toContain('/activate');
	});
});

describe('createNdaDraft', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('crée sans activer', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			Response.json({ id: 'req_draft', status: 'draft', signers: [] }),
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await createNdaDraft({
			enrollmentId: 'enr_1',
			email: 'a@b.c',
			firstName: 'Ada',
			lastName: 'Lovelace',
		});

		expect(result).toEqual({ requestId: 'req_draft' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/signature_requests$/);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.name).toBe('NDA — Ada Lovelace');
		expect(body.external_id).toBe('enr_1');
	});
});

describe('syncYousignStatus', () => {
	beforeEach(() => {
		findUnique.mockReset();
		update.mockReset();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('refuse sans yousignRequestId', async () => {
		findUnique.mockResolvedValueOnce({ id: 'enr_1', yousignRequestId: null });

		const result = await syncYousignStatus('enr_1');

		expect(result).toEqual({ ok: false, reason: 'no_yousign_request' });
		expect(update).not.toHaveBeenCalled();
	});

	it('aligne yousignStatus sans toucher au status métier', async () => {
		findUnique.mockResolvedValueOnce({
			id: 'enr_1',
			yousignRequestId: 'req_1',
			status: 'nda_envoye',
			yousignStatus: 'ongoing',
		});
		vi.mocked(fetch).mockResolvedValueOnce(
			Response.json({ id: 'req_1', status: 'done', signers: [] }),
		);
		update.mockResolvedValueOnce({});

		const result = await syncYousignStatus('enr_1');

		expect(result).toEqual({ ok: true, yousignStatus: 'done' });
		expect(update).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: { yousignStatus: 'done' },
		});
	});
});
