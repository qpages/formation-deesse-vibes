import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEnrollmentById, syncNdaStatus } = vi.hoisted(() => ({
	findEnrollmentById: vi.fn(),
	syncNdaStatus: vi.fn(),
}));

vi.mock('../enrollment/queries', () => ({ findEnrollmentById }));
vi.mock('./sync-nda', () => ({ syncNdaStatus }));

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
		expect(syncNdaStatus).not.toHaveBeenCalled();
	});

	it('Yousign done → signed true', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'done',
			followUp: { status: 'enqueued' },
		});

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: true,
		});
		expect(syncNdaStatus).toHaveBeenCalledWith('enr_1');
	});

	it('Yousign encore ongoing → signed false', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'ongoing',
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
		expect(syncNdaStatus).not.toHaveBeenCalled();
	});

	it('sans demande NDA → no_nda_request', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		syncNdaStatus.mockResolvedValue({ ok: false, reason: 'no_nda_request' });

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: false,
			reason: 'no_nda_request',
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
