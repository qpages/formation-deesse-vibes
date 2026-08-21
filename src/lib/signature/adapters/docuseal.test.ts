import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../env', () => ({
	getEnv: vi.fn(() => ({
		DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
		SIGNATURE_PROVIDER: 'docuseal',
	})),
	requireEnv: (key: string) => {
		if (key === 'DOCUSEAL_API_KEY') return 'ds_test_key';
		if (key === 'DOCUSEAL_WEBHOOK_SECRET') return 'whsec_test';
		if (key === 'DOCUSEAL_TEMPLATE_ID') return '10000';
		throw new Error(`missing ${key}`);
	},
	isInngestDevMode: () => true,
}));
vi.mock('../../e2e-providers', () => ({ e2eMockProviders: () => false }));
vi.mock('../../inngest/client', () => ({ sendInngestSafe: vi.fn() }));

import { getEnv } from '../../env';
import { docusealAdapter, mapDocusealCompletedEvent } from './docuseal';

describe('DocuSeal adapter', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	it('mapCompletedEvent extrait requestId depuis form.completed', () => {
		const payload = {
			event_type: 'form.completed',
			timestamp: '2023-09-24T13:48:36Z',
			data: {
				id: 42,
				submission_id: 12,
				external_id: 'enr_1',
				completed_at: '2023-08-20T10:12:47.579Z',
				submission: { id: 12, external_id: 'enr_1', status: 'completed' },
			},
		};

		expect(mapDocusealCompletedEvent(payload)).toEqual({
			requestId: '12',
			externalId: 'enr_1',
			occurredAt: new Date('2023-08-20T10:12:47.579Z'),
		});
	});

	it('mapCompletedEvent extrait requestId depuis submission.completed', () => {
		const payload = {
			event_type: 'submission.completed',
			timestamp: '2023-09-24T13:48:36Z',
			data: {
				id: 12,
				external_id: 'enr_1',
				completed_at: '2023-08-20T10:12:47.579Z',
				submitters: [{ external_id: 'enr_1' }],
			},
		};

		expect(mapDocusealCompletedEvent(payload)).toEqual({
			requestId: '12',
			externalId: 'enr_1',
			occurredAt: new Date('2023-08-20T10:12:47.579Z'),
		});
	});

	it('webhook.verify valide X-Docuseal-Signature', () => {
		const rawBody = '{"event_type":"form.completed"}';
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = createHmac('sha256', 'whsec_test')
			.update(`${timestamp}.${rawBody}`)
			.digest('hex');

		expect(docusealAdapter.verify(rawBody, `${timestamp}.${signature}`)).toBe(true);
		expect(docusealAdapter.verify(rawBody, 'bad')).toBe(false);
	});

	it('webhook.verify rejette timestamp expiré (>5 min)', () => {
		const rawBody = '{"event_type":"form.completed"}';
		const timestamp = String(Math.floor(Date.now() / 1000) - 400);
		const signature = createHmac('sha256', 'whsec_test')
			.update(`${timestamp}.${rawBody}`)
			.digest('hex');

		expect(docusealAdapter.verify(rawBody, `${timestamp}.${signature}`)).toBe(false);
	});

	it('createSubmission embed envoie send_email false', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify([
					{
						id: 42,
						submission_id: 12,
						email: 'a@b.c',
						embed_src: 'https://docuseal.eu/s/abc',
					},
				]),
				{ status: 200 },
			),
		);

		await docusealAdapter.provisionNda({
			step: 'draft',
			enrollmentId: 'enr_1',
			email: 'a@b.c',
			firstName: 'A',
			lastName: 'B',
		});

		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const body = JSON.parse(String(init?.body));
		expect(body.send_email).toBe(false);
		expect(body.submitters[0].send_email).toBe(false);
	});

	it('createSubmission redirect envoie send_email true', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
			SIGNATURE_MODE: 'redirect',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify([
					{
						id: 42,
						submission_id: 12,
						email: 'a@b.c',
						embed_src: 'https://docuseal.eu/s/abc',
					},
				]),
				{ status: 200 },
			),
		);

		await docusealAdapter.provisionNda({
			step: 'draft',
			enrollmentId: 'enr_1',
			email: 'a@b.c',
			firstName: 'A',
			lastName: 'B',
		});

		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const body = JSON.parse(String(init?.body));
		expect(body.send_email).toBe(true);
		expect(body.submitters[0].send_email).toBe(true);
	});

	it('getSignSurface redirect retourne url', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
			SIGNATURE_MODE: 'redirect',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					id: 12,
					status: 'pending',
					submitters: [{ id: 42, embed_src: 'https://docuseal.eu/s/abc' }],
				}),
				{ status: 200 },
			),
		);

		const surface = await docusealAdapter.getSignSurface({
			requestId: '12',
			signerId: '42',
		});

		expect(surface).toEqual({ kind: 'redirect', url: 'https://docuseal.eu/s/abc' });
	});

	it('getSignSurface embed retombe sur slug si embed_src absent', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					id: 1497165,
					status: 'pending',
					submitters: [{ id: 1857088, slug: 'NLp5rn3W8tEtnj' }],
				}),
				{ status: 200 },
			),
		);

		const surface = await docusealAdapter.getSignSurface({
			requestId: '1497165',
			signerId: '1857088',
			email: 'a@b.c',
		});

		expect(surface).toEqual({
			kind: 'embed',
			provider: 'docuseal',
			src: 'https://docuseal.eu/s/NLp5rn3W8tEtnj',
			email: 'a@b.c',
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('getSignSurface interroge GET /submitters/{id} si la soumission n’a ni embed_src ni slug', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 1497165,
						status: 'pending',
						submitters: [{ id: 1857088, email: 'a@b.c' }],
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 1857088,
						submission_id: 1497165,
						slug: 'NLp5rn3W8tEtnj',
					}),
					{ status: 200 },
				),
			);

		const surface = await docusealAdapter.getSignSurface({
			requestId: '1497165',
			signerId: '1857088',
			email: 'a@b.c',
		});

		expect(surface).toEqual({
			kind: 'embed',
			provider: 'docuseal',
			src: 'https://docuseal.eu/s/NLp5rn3W8tEtnj',
			email: 'a@b.c',
		});
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain('/submitters/1857088');
	});

	it('getSignSurface retourne null si aucune URL après fallback submitter', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 12,
						status: 'pending',
						submitters: [{ id: 42, email: 'a@b.c' }],
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: 42, submission_id: 12, email: 'a@b.c' }), {
					status: 200,
				}),
			);

		const surface = await docusealAdapter.getSignSurface({
			requestId: '12',
			signerId: '42',
			email: 'a@b.c',
		});

		expect(surface).toBeNull();
	});

	it('provisionNda activate retombe sur slug si embed_src absent', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					id: 1497165,
					status: 'pending',
					submitters: [{ id: 1857088, slug: 'NLp5rn3W8tEtnj' }],
				}),
				{ status: 200 },
			),
		);

		const result = await docusealAdapter.provisionNda({
			step: 'activate',
			requestId: '1497165',
		});

		expect(result).toEqual({
			requestId: '1497165',
			signerId: '1857088',
			signatureLink: 'https://docuseal.eu/s/NLp5rn3W8tEtnj',
		});
	});

	it('provisionNda activate interroge GET /submitters/{id} si la soumission n’a ni embed_src ni slug', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 1497165,
						status: 'pending',
						submitters: [{ id: 1857088, email: 'a@b.c' }],
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 1857088,
						submission_id: 1497165,
						slug: 'NLp5rn3W8tEtnj',
					}),
					{ status: 200 },
				),
			);

		const result = await docusealAdapter.provisionNda({
			step: 'activate',
			requestId: '1497165',
		});

		expect(result).toEqual({
			requestId: '1497165',
			signerId: '1857088',
			signatureLink: 'https://docuseal.eu/s/NLp5rn3W8tEtnj',
		});
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('getSignSurface embed retourne src + email', async () => {
		vi.mocked(getEnv).mockReturnValue({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
			SIGNATURE_PROVIDER: 'docuseal',
		} as ReturnType<typeof getEnv>);

		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					id: 12,
					status: 'pending',
					submitters: [{ id: 42, embed_src: 'https://docuseal.eu/s/abc' }],
				}),
				{ status: 200 },
			),
		);

		const surface = await docusealAdapter.getSignSurface({
			requestId: '12',
			signerId: '42',
			email: 'a@b.c',
		});

		expect(surface).toEqual({
			kind: 'embed',
			provider: 'docuseal',
			src: 'https://docuseal.eu/s/abc',
			email: 'a@b.c',
		});
	});
});
