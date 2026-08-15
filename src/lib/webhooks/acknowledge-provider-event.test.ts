import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordProviderEvent, sendInngestSafe } = vi.hoisted(() => ({
	recordProviderEvent: vi.fn(),
	sendInngestSafe: vi.fn(),
}));

vi.mock('../services/provider-events', () => ({ recordProviderEvent }));
vi.mock('../inngest/client', () => ({ sendInngestSafe }));

import { acknowledgeProviderEvent } from './acknowledge-provider-event';

beforeEach(() => {
	vi.clearAllMocks();
});

const input = {
	provider: 'stripe' as const,
	providerEventId: 'evt_1',
	eventType: 'checkout.session.completed',
	payload: { id: 'evt_1' },
};

describe('acknowledgeProviderEvent', () => {
	it('premier event → enqueue', async () => {
		recordProviderEvent.mockResolvedValue({ created: true, id: 'pe_1', status: 'received' });
		sendInngestSafe.mockResolvedValue({ status: 'enqueued' });

		const res = await acknowledgeProviderEvent(input);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ received: true, duplicate: false });
		expect(sendInngestSafe).toHaveBeenCalledWith({
			name: 'provider/stripe-event.received',
			data: { providerEventId: 'pe_1' },
		});
	});

	it('duplicate processed → pas d’enqueue', async () => {
		recordProviderEvent.mockResolvedValue({
			created: false,
			id: 'pe_1',
			status: 'processed',
		});

		const res = await acknowledgeProviderEvent(input);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ received: true, duplicate: true });
		expect(sendInngestSafe).not.toHaveBeenCalled();
	});

	it('duplicate received → re-enqueue', async () => {
		recordProviderEvent.mockResolvedValue({
			created: false,
			id: 'pe_1',
			status: 'received',
		});
		sendInngestSafe.mockResolvedValue({ status: 'enqueued' });

		const res = await acknowledgeProviderEvent(input);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ received: true, duplicate: true });
		expect(sendInngestSafe).toHaveBeenCalledTimes(1);
	});

	it('duplicate failed → re-enqueue', async () => {
		recordProviderEvent.mockResolvedValue({
			created: false,
			id: 'pe_1',
			status: 'failed',
		});
		sendInngestSafe.mockResolvedValue({ status: 'enqueued' });

		const res = await acknowledgeProviderEvent(input);
		expect(res.status).toBe(200);
		expect(sendInngestSafe).toHaveBeenCalled();
	});

	it('enqueue failed → 500 pour retry provider', async () => {
		recordProviderEvent.mockResolvedValue({ created: true, id: 'pe_1', status: 'received' });
		sendInngestSafe.mockResolvedValue({ status: 'failed', error: 'down' });

		const res = await acknowledgeProviderEvent(input);
		expect(res.status).toBe(500);
	});
});
