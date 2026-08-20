import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEnrollmentById, sendInngestSafe } = vi.hoisted(() => ({
	findEnrollmentById: vi.fn(),
	sendInngestSafe: vi.fn(),
}));

vi.mock('../enrollment', () => ({ findEnrollmentById }));
vi.mock('../inngest/client', () => ({ sendInngestSafe }));

import { ensureNdaAfterPayment } from './nda-trigger';

const paidEnrollment = {
	id: 'enr_1',
	collectionStatus: 'current' as const,
	contractStatus: 'pending' as const,
	ndaRequest: null,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('ensureNdaAfterPayment', () => {
	it('skip si enrollment introuvable', async () => {
		findEnrollmentById.mockResolvedValue(null);

		const result = await ensureNdaAfterPayment('enr_missing', 'src_1');

		expect(result).toEqual({ status: 'skipped' });
		expect(sendInngestSafe).not.toHaveBeenCalled();
	});

	it('skip si pas assez payé', async () => {
		findEnrollmentById.mockResolvedValue({ ...paidEnrollment, collectionStatus: 'pending' });

		const result = await ensureNdaAfterPayment('enr_1', 'src_1');

		expect(result).toEqual({ status: 'skipped' });
		expect(sendInngestSafe).not.toHaveBeenCalled();
	});

	it('skip si NDA déjà provisionné', async () => {
		findEnrollmentById.mockResolvedValue({
			...paidEnrollment,
			ndaRequest: { externalRequestId: 'req', externalSignerId: 'signer', provider: 'yousign' },
		});

		const result = await ensureNdaAfterPayment('enr_1', 'src_1');

		expect(result).toEqual({ status: 'skipped' });
		expect(sendInngestSafe).not.toHaveBeenCalled();
	});

	it('enqueue le job NDA quand éligible', async () => {
		findEnrollmentById.mockResolvedValue(paidEnrollment);
		sendInngestSafe.mockResolvedValue({ status: 'enqueued' });

		const result = await ensureNdaAfterPayment('enr_1', 'cs_123');

		expect(sendInngestSafe).toHaveBeenCalledWith({
			id: 'nda-after-payment:enr_1',
			name: 'stripe/payment.confirmed',
			data: { enrollmentId: 'enr_1', stripeEventId: 'cs_123' },
		});
		expect(result).toEqual({ status: 'enqueued' });
	});

	it('throw si enqueue échoue (mode dur)', async () => {
		findEnrollmentById.mockResolvedValue(paidEnrollment);
		sendInngestSafe.mockResolvedValue({ status: 'failed', error: 'network' });

		await expect(ensureNdaAfterPayment('enr_1', 'cs_123')).rejects.toThrow(
			'Enqueue NDA échoué: network',
		);
	});

	it('retourne failed en mode soft sans throw', async () => {
		findEnrollmentById.mockResolvedValue(paidEnrollment);
		sendInngestSafe.mockResolvedValue({ status: 'failed', error: 'network' });

		const result = await ensureNdaAfterPayment('enr_1', 'cs_123', { soft: true });

		expect(result).toEqual({ status: 'failed', error: 'network' });
	});
});
