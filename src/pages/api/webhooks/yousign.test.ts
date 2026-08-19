import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verify } = vi.hoisted(() => ({
	verify: vi.fn(),
}));

vi.mock('../../../lib/signature/adapters/yousign', () => ({
	yousignAdapter: { verify },
}));
vi.mock('../../../lib/webhooks/acknowledge-provider-event', () => ({
	acknowledgeProviderEvent: vi.fn(),
}));

import { acknowledgeProviderEvent } from '../../../lib/webhooks/acknowledge-provider-event';
import { POST } from './yousign';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/webhooks/yousign', () => {
	it('utilise yousignAdapter.verify directement (pas factory)', async () => {
		verify.mockReturnValue(false);

		const response = await POST({
			request: new Request('http://localhost/api/webhooks/yousign', {
				method: 'POST',
				body: '{"event_name":"signature_request.done"}',
				headers: { 'x-yousign-signature-256': 'bad' },
			}),
		} as Parameters<typeof POST>[0]);

		expect(verify).toHaveBeenCalledWith('{"event_name":"signature_request.done"}', 'bad');
		expect(acknowledgeProviderEvent).not.toHaveBeenCalled();
		expect(response.status).toBe(400);
	});

	it('signature valide → acknowledgeProviderEvent', async () => {
		const rawBody = JSON.stringify({
			event_name: 'signature_request.done',
			event_id: 'evt_1',
			data: { signature_request: { id: 'req_1' } },
		});
		verify.mockReturnValue(true);
		vi.mocked(acknowledgeProviderEvent).mockResolvedValue(
			new Response(JSON.stringify({ received: true }), { status: 200 }),
		);

		const response = await POST({
			request: new Request('http://localhost/api/webhooks/yousign', {
				method: 'POST',
				body: rawBody,
				headers: {
					'x-yousign-signature-256': createHmac('sha256', 'secret').update(rawBody).digest('hex'),
				},
			}),
		} as Parameters<typeof POST>[0]);

		expect(acknowledgeProviderEvent).toHaveBeenCalledWith({
			provider: 'yousign',
			providerEventId: 'evt_1',
			eventType: 'signature_request.done',
			payload: JSON.parse(rawBody),
		});
		expect(response.status).toBe(200);
	});
});
