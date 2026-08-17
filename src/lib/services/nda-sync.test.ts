import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEnrollmentById, syncYousignStatus } = vi.hoisted(() => ({
	findEnrollmentById: vi.fn(),
	syncYousignStatus: vi.fn(),
}));

vi.mock('./enrollment', () => ({ findEnrollmentById }));
vi.mock('./yousign-events', () => ({ syncYousignStatus }));

import { confirmLearnerNdaSignature } from './nda-sync';

function enrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		collectionStatus: 'paid',
		contractStatus: 'sent',
		accessStatus: 'not_eligible',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('confirmLearnerNdaSignature', () => {
	it('déjà signé → signed true sans appeler Yousign', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ contractStatus: 'signed' }));

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: true,
		});
		expect(syncYousignStatus).not.toHaveBeenCalled();
	});

	it('Yousign done → signed true', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		syncYousignStatus.mockResolvedValue({
			ok: true,
			yousignStatus: 'done',
			followUp: { status: 'ok' },
		});

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: true,
		});
		expect(syncYousignStatus).toHaveBeenCalledWith('enr_1');
	});

	it('Yousign encore ongoing → signed false', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		syncYousignStatus.mockResolvedValue({
			ok: true,
			yousignStatus: 'ongoing',
			followUp: { status: 'skipped' },
		});

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: false,
		});
	});

	it('pas en attente NDA → not_awaiting', async () => {
		findEnrollmentById.mockResolvedValue(
			enrollment({ collectionStatus: 'pending', contractStatus: 'pending' }),
		);

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: false,
			reason: 'not_awaiting',
		});
		expect(syncYousignStatus).not.toHaveBeenCalled();
	});

	it('sans demande Yousign → no_yousign_request', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		syncYousignStatus.mockResolvedValue({ ok: false, reason: 'no_yousign_request' });

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: false,
			reason: 'no_yousign_request',
		});
	});

	it('inscription introuvable', async () => {
		findEnrollmentById.mockResolvedValue(null);

		await expect(confirmLearnerNdaSignature('enr_missing')).resolves.toEqual({
			ok: false,
			reason: 'enrollment_not_found',
		});
	});
});
