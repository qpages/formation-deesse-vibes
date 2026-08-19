import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignaturePort, SignatureWebhookAdapter } from '../types';
import { yousignAdapter } from './yousign';

vi.mock('../../env', () => ({
	getEnv: () => ({
		YOUSIGN_API_BASE: 'https://api-sandbox.yousign.app/v3',
		SIGNATURE_PROVIDER: 'yousign',
	}),
	requireEnv: (key: string) => {
		if (key === 'YOUSIGN_API_KEY') return 'ys_test_key';
		if (key === 'YOUSIGN_WEBHOOK_SECRET') return 'whsec_test';
		if (key === 'YOUSIGN_TEMPLATE_ID') return 'tpl_1';
		if (key === 'YOUSIGN_SIGNER_LABEL') return 'signer';
		throw new Error(`missing ${key}`);
	},
	FORMATION: { name: 'Formation Matrice Évolution', brand: 'Déesse Vibes' },
}));
vi.mock('../../e2e-providers', () => ({ e2eMockProviders: () => false }));

const port: SignaturePort = yousignAdapter;
const webhook: SignatureWebhookAdapter = yousignAdapter;

describe('YouSign adapter port contract', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	it('provisionNda draft → requestId', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ id: 'req-draft' }), { status: 200 }),
		);

		const result = await port.provisionNda({
			step: 'draft',
			enrollmentId: 'enr_1',
			email: 'a@b.c',
			firstName: 'Ada',
			lastName: 'Lovelace',
		});

		expect(result).toEqual({ requestId: 'req-draft' });
	});

	it('provisionNda activate → signerId', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 'req_1',
						status: 'draft',
						signers: [{ id: 'sig_1', status: 'initiated', signature_link: 'https://sign' }],
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 'req_1',
						status: 'ongoing',
						signers: [{ id: 'sig_1', status: 'notified', signature_link: 'https://sign' }],
					}),
					{ status: 200 },
				),
			);

		const result = await port.provisionNda({ step: 'activate', requestId: 'req_1' });

		expect(result).toEqual({
			requestId: 'req_1',
			signerId: 'sig_1',
			signatureLink: 'https://sign',
		});
	});

	it('getSignSurface → signature_link', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({ id: 'sig_1', status: 'notified', signature_link: 'https://sign/here' }),
				{ status: 200 },
			),
		);

		await expect(
			port.getSignSurface({ requestId: 'req_1', signerId: 'sig_1' }),
		).resolves.toBe('https://sign/here');
	});

	it('webhook.verify valide la signature HMAC', () => {
		const rawBody = '{"event_name":"signature_request.done"}';
		const signature = createHmac('sha256', 'whsec_test').update(rawBody).digest('hex');

		expect(webhook.verify(rawBody, signature)).toBe(true);
		expect(webhook.verify(rawBody, 'bad')).toBe(false);
	});

	it('webhook.mapCompletedEvent extrait requestId + externalId', () => {
		const payload = {
			event_name: 'signature_request.done',
			event_time: 1_700_000_000,
			data: {
				signature_request: { id: 'req_done', external_id: 'enr_1' },
			},
		};

		expect(webhook.mapCompletedEvent(payload)).toEqual({
			requestId: 'req_done',
			externalId: 'enr_1',
			occurredAt: new Date(1_700_000_000_000),
		});
		expect(webhook.mapCompletedEvent({ event_name: 'signer.notified' })).toBeNull();
	});
});
