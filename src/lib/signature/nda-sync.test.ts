import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEnrollmentById, syncNdaStatus } = vi.hoisted(() => ({
	findEnrollmentById: vi.fn(),
	syncNdaStatus: vi.fn(),
}));

vi.mock('../enrollment/queries', () => ({ findEnrollmentById }));
vi.mock('./sync-nda', () => ({ syncNdaStatus }));

import {
	confirmLearnerNdaSignature,
	confirmLearnerNdaSignatureFromWebhook,
} from './nda-sync';

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
	it('déjà signé → signed true sans appeler le provider', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ contractStatus: 'signed' }));

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: true,
			followUp: { status: 'skipped' },
		});
		expect(syncNdaStatus).not.toHaveBeenCalled();
	});

	it('provider done → signed true (DB-driven)', async () => {
		findEnrollmentById
			.mockResolvedValueOnce(enrollment())
			.mockResolvedValueOnce(enrollment({ contractStatus: 'signed' }));
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'done',
			followUp: { status: 'enqueued' },
		});

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: true,
			followUp: { status: 'enqueued' },
		});
		expect(syncNdaStatus).toHaveBeenCalledWith('enr_1');
	});

	it('DocuSeal completed → signed true via relecture DB', async () => {
		findEnrollmentById
			.mockResolvedValueOnce(enrollment())
			.mockResolvedValueOnce(enrollment({ contractStatus: 'signed' }));
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'completed',
			followUp: { status: 'enqueued' },
		});

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: true,
			followUp: { status: 'enqueued' },
		});
	});

	it('provider encore ongoing → signed false', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'ongoing',
			followUp: { status: 'skipped' },
		});

		await expect(confirmLearnerNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: false,
			followUp: { status: 'skipped' },
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

describe('confirmLearnerNdaSignatureFromWebhook', () => {
	it('délègue à confirmLearnerNdaSignature et retourne enrollmentId', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ contractStatus: 'signed' }));

		await expect(confirmLearnerNdaSignatureFromWebhook('enr_1')).resolves.toEqual({
			enrollmentId: 'enr_1',
		});
	});

	it('retry si pas encore signé côté provider', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'pending',
			followUp: { status: 'skipped' },
		});

		await expect(confirmLearnerNdaSignatureFromWebhook('enr_1')).rejects.toThrow(
			'Signature pas encore visible chez le provider',
		);
	});

	it('retry si enqueue Teachizy échoué', async () => {
		findEnrollmentById
			.mockResolvedValueOnce(enrollment())
			.mockResolvedValueOnce(enrollment({ contractStatus: 'signed' }));
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'completed',
			followUp: { status: 'failed', error: 'queue down' },
		});

		await expect(confirmLearnerNdaSignatureFromWebhook('enr_1')).rejects.toThrow(
			'Enqueue Teachizy échoué: queue down',
		);
	});
});
