import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../env', () => ({
	getEnv: () => ({
		DOCUSEAL_API_BASE: 'https://api.docuseal.com',
		SIGNATURE_PROVIDER: 'docuseal',
	}),
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

	it('webhook.verify valide X-Docuseal-Signature', () => {
		const rawBody = '{"event_type":"form.completed"}';
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = createHmac('sha256', 'whsec_test')
			.update(`${timestamp}.${rawBody}`)
			.digest('hex');

		expect(docusealAdapter.verify(rawBody, `${timestamp}.${signature}`)).toBe(true);
		expect(docusealAdapter.verify(rawBody, 'bad')).toBe(false);
	});
});
