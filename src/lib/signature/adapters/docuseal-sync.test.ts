import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	ensureTeachizyAfterSignature,
	findEnrollmentById,
	notifyOps,
	persistNdaSyncMirror,
	recordNdaError,
} = vi.hoisted(() => ({
	ensureTeachizyAfterSignature: vi.fn(),
	findEnrollmentById: vi.fn(),
	notifyOps: vi.fn(),
	persistNdaSyncMirror: vi.fn(),
	recordNdaError: vi.fn(),
}));

vi.mock('../../enrollment/queries', () => ({ findEnrollmentById }));
vi.mock('../after-signature', () => ({ ensureTeachizyAfterSignature }));
vi.mock('../persist', () => ({ persistNdaSyncMirror, recordNdaError }));
vi.mock('../../services/slack', () => ({ formatErrorDetail: (e: unknown) => String(e), notifyOps }));

import { syncDocusealNda } from './docuseal-sync';

function enrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		contractStatus: 'sent',
		ndaSignedAt: null,
		user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' },
		ndaRequest: { externalRequestId: 'sub_12', externalSignerId: '42' },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	findEnrollmentById.mockResolvedValue(enrollment());
	persistNdaSyncMirror.mockResolvedValue(enrollment());
	ensureTeachizyAfterSignature.mockResolvedValue({ status: 'enqueued' });
});

describe('syncDocusealNda', () => {
	it('marque signé quand la soumission est completed', async () => {
		const getSubmission = vi.fn().mockResolvedValue({
			id: 12,
			status: 'completed',
			completed_at: '2024-06-01T10:00:00.000Z',
			submitters: [{ id: 42, status: 'completed', completed_at: '2024-06-01T10:00:00.000Z' }],
		});

		await expect(
			syncDocusealNda('enr_1', { getSubmission }),
		).resolves.toEqual({
			ok: true,
			providerStatus: 'completed',
			followUp: { status: 'enqueued' },
		});

		expect(persistNdaSyncMirror).toHaveBeenCalledWith(
			'enr_1',
			expect.objectContaining({
				contractStatus: 'signed',
				providerStatus: 'completed',
			}),
		);
		expect(ensureTeachizyAfterSignature).toHaveBeenCalledWith(
			'enr_1',
			'sync-docuseal:enr_1',
			'sub_12',
		);
		expect(notifyOps).toHaveBeenCalled();
	});

	it('marque signé quand le signataire est complété mais la soumission reste awaiting', async () => {
		const getSubmission = vi.fn().mockResolvedValue({
			id: 12,
			status: 'awaiting',
			submitters: [{ id: 42, status: 'awaiting', completed_at: '2024-06-01T10:00:00.000Z' }],
		});
		const getSubmitter = vi.fn();

		await expect(
			syncDocusealNda('enr_1', { getSubmission, getSubmitter }),
		).resolves.toEqual({
			ok: true,
			providerStatus: 'awaiting',
			followUp: { status: 'enqueued' },
		});

		expect(getSubmitter).not.toHaveBeenCalled();
		expect(persistNdaSyncMirror).toHaveBeenCalledWith(
			'enr_1',
			expect.objectContaining({
				contractStatus: 'signed',
				providerStatus: 'awaiting',
			}),
		);
	});

	it('interroge GET /submitters quand la soumission omet completed_at', async () => {
		const getSubmission = vi.fn().mockResolvedValue({
			id: 12,
			status: 'awaiting',
			submitters: [{ id: 42, status: 'awaiting' }],
		});
		const getSubmitter = vi.fn().mockResolvedValue({
			id: 42,
			status: 'awaiting',
			completed_at: '2024-06-01T10:00:00.000Z',
		});

		await syncDocusealNda('enr_1', { getSubmission, getSubmitter });

		expect(getSubmitter).toHaveBeenCalledWith('42');
		expect(persistNdaSyncMirror).toHaveBeenCalledWith(
			'enr_1',
			expect.objectContaining({ contractStatus: 'signed' }),
		);
	});

	it('retourne ok sans signer quand le provider est encore pending', async () => {
		const getSubmission = vi.fn().mockResolvedValue({
			id: 12,
			status: 'pending',
			submitters: [{ id: 42, status: 'awaiting' }],
		});

		await expect(
			syncDocusealNda('enr_1', { getSubmission }),
		).resolves.toEqual({
			ok: true,
			providerStatus: 'pending',
			followUp: { status: 'skipped' },
		});

		expect(persistNdaSyncMirror).toHaveBeenCalledWith(
			'enr_1',
			expect.objectContaining({ contractStatus: 'sent' }),
		);
		expect(ensureTeachizyAfterSignature).not.toHaveBeenCalled();
	});
});
