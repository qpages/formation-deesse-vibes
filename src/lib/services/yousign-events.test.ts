import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	decryptPayload,
	findEnrollmentByExternalRequestOrEnrollmentId,
	confirmLearnerNdaSignatureFromWebhook,
	persistNdaSyncMirror,
} = vi.hoisted(() => ({
	decryptPayload: vi.fn(),
	findEnrollmentByExternalRequestOrEnrollmentId: vi.fn(),
	confirmLearnerNdaSignatureFromWebhook: vi.fn(),
	persistNdaSyncMirror: vi.fn(),
}));

vi.mock('../crypto', () => ({ decryptPayload }));
vi.mock('../enrollment/queries', () => ({ findEnrollmentByExternalRequestOrEnrollmentId }));
vi.mock('../signature/nda-sync', () => ({ confirmLearnerNdaSignatureFromWebhook }));
vi.mock('../signature/persist', () => ({ persistNdaSyncMirror }));
vi.mock('./slack', () => ({ notifyOps: vi.fn() }));

import { handleYousignProviderEvent } from './yousign-events';

const enrollment = { id: 'enr_1', ndaNotifiedAt: null, ndaLinkOpenedAt: null };

beforeEach(() => {
	vi.clearAllMocks();
	confirmLearnerNdaSignatureFromWebhook.mockResolvedValue({ enrollmentId: 'enr_1' });
});

describe('handleYousignProviderEvent signature_request.done', () => {
	it('délègue à confirmLearnerNdaSignatureFromWebhook', async () => {
		decryptPayload.mockReturnValue(
			JSON.stringify({
				event_name: 'signature_request.done',
				data: { signature_request: { id: 'req_1', external_id: 'enr_1' } },
			}),
		);
		findEnrollmentByExternalRequestOrEnrollmentId.mockResolvedValue(enrollment);

		await expect(
			handleYousignProviderEvent({
				providerEventId: 'evt_1',
				eventType: 'signature_request.done',
				payloadCipherText: 'cipher',
			}),
		).resolves.toEqual({ enrollmentId: 'enr_1' });

		expect(confirmLearnerNdaSignatureFromWebhook).toHaveBeenCalledWith('enr_1');
		expect(persistNdaSyncMirror).not.toHaveBeenCalled();
	});
});

describe('handleYousignProviderEvent engagement', () => {
	it('signer.notified met à jour le miroir sans confirm', async () => {
		decryptPayload.mockReturnValue(
			JSON.stringify({
				event_name: 'signer.notified',
				event_time: '2024-01-01T12:00:00Z',
				data: { signature_request: { id: 'req_1' } },
			}),
		);
		findEnrollmentByExternalRequestOrEnrollmentId.mockResolvedValue(enrollment);

		await expect(
			handleYousignProviderEvent({
				providerEventId: 'evt_2',
				eventType: 'signer.notified',
				payloadCipherText: 'cipher',
			}),
		).resolves.toEqual({ enrollmentId: 'enr_1' });

		expect(persistNdaSyncMirror).toHaveBeenCalled();
		expect(confirmLearnerNdaSignatureFromWebhook).not.toHaveBeenCalled();
	});
});
