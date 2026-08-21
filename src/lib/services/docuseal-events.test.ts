import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	decryptPayload,
	findEnrollmentByExternalRequestOrEnrollmentId,
	confirmNdaSignatureFromWebhook,
} = vi.hoisted(() => ({
	decryptPayload: vi.fn(),
	findEnrollmentByExternalRequestOrEnrollmentId: vi.fn(),
	confirmNdaSignatureFromWebhook: vi.fn(),
}));

vi.mock('../crypto', () => ({ decryptPayload }));
vi.mock('../enrollment/queries', () => ({ findEnrollmentByExternalRequestOrEnrollmentId }));
vi.mock('../enrollment/confirm-nda-signature', () => ({ confirmNdaSignatureFromWebhook }));

import { handleDocusealProviderEvent, isHandledDocusealEventType } from './docuseal-events';

beforeEach(() => {
	vi.clearAllMocks();
	decryptPayload.mockReturnValue(
		JSON.stringify({
			event_type: 'form.completed',
			data: { submission: { id: 'sub_1' }, completed_at: '2024-01-01T12:00:00Z' },
		}),
	);
	findEnrollmentByExternalRequestOrEnrollmentId.mockResolvedValue({ id: 'enr_1' });
	confirmNdaSignatureFromWebhook.mockResolvedValue({ enrollmentId: 'enr_1' });
});

describe('isHandledDocusealEventType', () => {
	it('accepte form.completed et submission.completed', () => {
		expect(isHandledDocusealEventType('form.completed')).toBe(true);
		expect(isHandledDocusealEventType('submission.completed')).toBe(true);
		expect(isHandledDocusealEventType('form.viewed')).toBe(false);
	});
});

describe('handleDocusealProviderEvent', () => {
	it('ignore les événements non gérés', async () => {
		await expect(
			handleDocusealProviderEvent({
				providerEventId: 'evt_1',
				eventType: 'form.viewed',
				payloadCipherText: 'cipher',
			}),
		).resolves.toEqual({ ignored: true });
		expect(confirmNdaSignatureFromWebhook).not.toHaveBeenCalled();
	});

	it('délègue la confirmation à confirmNdaSignatureFromWebhook', async () => {
		await expect(
			handleDocusealProviderEvent({
				providerEventId: 'evt_1',
				eventType: 'form.completed',
				payloadCipherText: 'cipher',
			}),
		).resolves.toEqual({ enrollmentId: 'enr_1' });

		expect(findEnrollmentByExternalRequestOrEnrollmentId).toHaveBeenCalledWith(
			'docuseal',
			'sub_1',
			undefined,
		);
		expect(confirmNdaSignatureFromWebhook).toHaveBeenCalledWith('enr_1');
	});
});
