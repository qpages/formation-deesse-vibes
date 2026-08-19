import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEnrollmentById, persistNdaSyncMirror, ensureTeachizyAfterSignature } = vi.hoisted(
	() => ({
		findEnrollmentById: vi.fn(),
		persistNdaSyncMirror: vi.fn(),
		ensureTeachizyAfterSignature: vi.fn(),
	}),
);

vi.mock('../services/enrollment', () => ({ findEnrollmentById }));
vi.mock('./persist', () => ({
	persistNdaSyncMirror,
	recordYousignError: vi.fn(),
}));
vi.mock('../services/slack', () => ({
	formatErrorDetail: vi.fn(),
	notifyOps: vi.fn(),
}));
vi.mock('./after-signature', () => ({ ensureTeachizyAfterSignature }));

import { syncYousignNda } from './adapters/yousign-sync';

const enrollment = {
	id: 'enr_1',
	contractStatus: 'sent' as const,
	ndaNotifiedAt: null,
	user: { firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.c' },
	ndaRequest: {
		provider: 'yousign' as const,
		externalRequestId: 'req_1',
		externalSignerId: 'sig_1',
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	findEnrollmentById.mockResolvedValue(enrollment);
	ensureTeachizyAfterSignature.mockResolvedValue({ status: 'skipped' });
});

describe('syncYousignNda dual-write', () => {
	it('persiste providerStatus + yousign* via persistNdaSyncMirror', async () => {
		const remoteFns = {
			getSignatureRequest: vi.fn().mockResolvedValue({
				status: 'ongoing',
				signers: [{ id: 'sig_1' }],
			}),
			getSigner: vi.fn().mockResolvedValue({
				status: 'notified',
				signature_link_expiration_date: null,
			}),
		};

		const result = await syncYousignNda('enr_1', remoteFns);

		expect(result).toEqual({
			ok: true,
			providerStatus: 'ongoing',
			followUp: { status: 'skipped' },
		});
		expect(persistNdaSyncMirror).toHaveBeenCalledWith(
			'enr_1',
			expect.objectContaining({
				yousignStatus: 'ongoing',
				providerStatus: 'ongoing',
				yousignSignerId: 'sig_1',
				yousignSignerStatus: 'notified',
			}),
		);
	});

	it('done → followUp ensureTeachizyAfterSignature', async () => {
		const remoteFns = {
			getSignatureRequest: vi.fn().mockResolvedValue({
				status: 'done',
				signers: [{ id: 'sig_1' }],
			}),
			getSigner: vi.fn().mockResolvedValue({
				status: 'signed',
				signed_at: '2024-01-01T12:00:00Z',
				signature_link_expiration_date: null,
			}),
		};
		ensureTeachizyAfterSignature.mockResolvedValue({ status: 'enqueued' });

		await syncYousignNda('enr_1', remoteFns);

		expect(ensureTeachizyAfterSignature).toHaveBeenCalledWith(
			'enr_1',
			'sync-nda:enr_1',
			'req_1',
		);
	});
});
