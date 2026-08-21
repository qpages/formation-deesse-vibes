import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Symptôme B — reproduction : un webhook DocuSeal `form.completed` reçu sur la
 * bonne route DOIT émettre l'event Inngest `provider/docuseal-event.received`.
 *
 * On ne mocke PAS `acknowledgeProviderEvent` ici (contrairement à docuseal.test.ts)
 * pour prouver la chaîne route → acknowledge → Inngest. Si aucun run Inngest ne
 * part en prod, c'est que le POST n'atteint jamais cette route (URL webhook
 * DocuSeal sans le chemin `/api/webhooks/docuseal`), pas que le code est cassé.
 */
const { verify, recordProviderEvent, sendInngestSafe } = vi.hoisted(() => ({
	verify: vi.fn(),
	recordProviderEvent: vi.fn(),
	sendInngestSafe: vi.fn(),
}));

vi.mock('../../../lib/signature/providers', () => ({
	resolveSignatureProvider: () => ({ verify }),
}));
vi.mock('../../../lib/enrollment/provider-events', () => ({ recordProviderEvent }));
vi.mock('../../../lib/inngest/client', () => ({ sendInngestSafe }));

import { POST } from './docuseal';

beforeEach(() => {
	vi.clearAllMocks();
	verify.mockReturnValue(true);
	recordProviderEvent.mockResolvedValue({ created: true, id: 'pe_1', status: 'received' });
	sendInngestSafe.mockResolvedValue({ status: 'enqueued' });
});

function postDocuseal(body: unknown) {
	return POST({
		request: new Request('http://localhost/api/webhooks/docuseal', {
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'x-docuseal-signature': 'valid' },
		}),
	} as Parameters<typeof POST>[0]);
}

describe('POST /api/webhooks/docuseal — émission Inngest (symptôme B)', () => {
	it('form.completed → provider/docuseal-event.received', async () => {
		const res = await postDocuseal({
			event_type: 'form.completed',
			timestamp: '2026-08-21T12:00:00Z',
			data: { id: 42, submission_id: 12, external_id: 'enr_1', completed_at: '2026-08-21T12:00:00Z' },
		});

		expect(res.status).toBe(200);
		expect(recordProviderEvent).toHaveBeenCalledWith(
			expect.objectContaining({ provider: 'docuseal', eventType: 'form.completed' }),
		);
		expect(sendInngestSafe).toHaveBeenCalledWith({
			name: 'provider/docuseal-event.received',
			data: { providerEventId: 'pe_1' },
		});
	});

	it('submission.completed → provider/docuseal-event.received', async () => {
		const res = await postDocuseal({
			event_type: 'submission.completed',
			timestamp: '2026-08-21T12:00:00Z',
			data: { id: 12, external_id: 'enr_1', completed_at: '2026-08-21T12:00:00Z' },
		});

		expect(res.status).toBe(200);
		expect(sendInngestSafe).toHaveBeenCalledWith({
			name: 'provider/docuseal-event.received',
			data: { providerEventId: 'pe_1' },
		});
	});

	it('form.viewed (non géré) → 200 sans Inngest', async () => {
		const res = await postDocuseal({ event_type: 'form.viewed', data: { id: 1 } });

		expect(res.status).toBe(200);
		expect(sendInngestSafe).not.toHaveBeenCalled();
	});
});
