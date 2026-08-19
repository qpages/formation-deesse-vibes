import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verify } = vi.hoisted(() => ({
	verify: vi.fn(),
}));

vi.mock('../../../lib/signature/adapters/docuseal', () => ({
	docusealAdapter: { verify },
}));
vi.mock('../../../lib/webhooks/acknowledge-provider-event', () => ({
	acknowledgeProviderEvent: vi.fn(),
}));

import { acknowledgeProviderEvent } from '../../../lib/webhooks/acknowledge-provider-event';
import { POST } from './docuseal';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/webhooks/docuseal', () => {
	it('utilise docusealAdapter.verify directement (pas factory)', async () => {
		verify.mockReturnValue(false);

		const response = await POST({
			request: new Request('http://localhost/api/webhooks/docuseal', {
				method: 'POST',
				body: '{"event_type":"form.completed"}',
				headers: { 'x-docuseal-signature': 'bad' },
			}),
		} as Parameters<typeof POST>[0]);

		expect(verify).toHaveBeenCalledWith('{"event_type":"form.completed"}', 'bad');
		expect(acknowledgeProviderEvent).not.toHaveBeenCalled();
		expect(response.status).toBe(400);
	});

	it('event ignoré → 200 sans acknowledgeProviderEvent', async () => {
		verify.mockReturnValue(true);

		const response = await POST({
			request: new Request('http://localhost/api/webhooks/docuseal', {
				method: 'POST',
				body: JSON.stringify({ event_type: 'submission.created', data: { id: 1 } }),
				headers: { 'x-docuseal-signature': 'valid' },
			}),
		} as Parameters<typeof POST>[0]);

		expect(acknowledgeProviderEvent).not.toHaveBeenCalled();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: true, ignored: true });
	});

	it('form.completed → acknowledgeProviderEvent', async () => {
		const rawBody = JSON.stringify({
			event_type: 'form.completed',
			timestamp: '2023-09-24T13:48:36Z',
			data: {
				id: 42,
				submission_id: 12,
				external_id: 'enr_1',
				completed_at: '2023-08-20T10:12:47.579Z',
			},
		});
		verify.mockReturnValue(true);
		vi.mocked(acknowledgeProviderEvent).mockResolvedValue(
			new Response(JSON.stringify({ received: true }), { status: 200 }),
		);

		const response = await POST({
			request: new Request('http://localhost/api/webhooks/docuseal', {
				method: 'POST',
				body: rawBody,
				headers: {
					'x-docuseal-signature': `${Math.floor(Date.now() / 1000)}.${createHmac('sha256', 'secret').update(`${Math.floor(Date.now() / 1000)}.${rawBody}`).digest('hex')}`,
				},
			}),
		} as Parameters<typeof POST>[0]);

		expect(acknowledgeProviderEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'docuseal',
				eventType: 'form.completed',
			}),
		);
		expect(response.status).toBe(200);
	});
});
