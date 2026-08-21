import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	findEnrollmentById,
	persistNdaSyncMirror,
	ensureTeachizyAfterSignature,
	notifyOps,
	getSubmission,
	getSubmitter,
} = vi.hoisted(() => ({
	findEnrollmentById: vi.fn(),
	persistNdaSyncMirror: vi.fn(),
	ensureTeachizyAfterSignature: vi.fn(),
	notifyOps: vi.fn(),
	getSubmission: vi.fn(),
	getSubmitter: vi.fn(),
}));

vi.mock('../enrollment/queries', () => ({ findEnrollmentById }));
vi.mock('../signature/persist', () => ({ persistNdaSyncMirror, recordNdaError: vi.fn() }));
vi.mock('../signature/after-signature', () => ({ ensureTeachizyAfterSignature }));
vi.mock('../services/slack', () => ({
	formatErrorDetail: (e: unknown) => String(e),
	notifyOps,
}));
vi.mock('../signature/adapters/docuseal', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../signature/adapters/docuseal')>();
	const { syncDocusealNda } = await import('../signature/adapters/docuseal-sync');
	return {
		...actual,
		docusealAdapter: {
			...actual.docusealAdapter,
			syncStatus: (enrollmentId: string) =>
				syncDocusealNda(enrollmentId, { getSubmission, getSubmitter }),
		},
	};
});

import { confirmNdaSignature } from '../enrollment/confirm-nda-signature';

function enrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		collectionStatus: 'paid',
		contractStatus: 'sent',
		accessStatus: 'not_eligible',
		ndaSignedAt: null,
		user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' },
		ndaRequest: {
			provider: 'docuseal',
			externalRequestId: 'sub_12',
			externalSignerId: '42',
		},
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	getSubmission.mockReset();
	getSubmitter.mockReset();

	let current = enrollment();
	findEnrollmentById.mockImplementation(async () => current);
	persistNdaSyncMirror.mockImplementation(async (_id, data) => {
		if (data.contractStatus) {
			current = enrollment({
				contractStatus: data.contractStatus,
				ndaSignedAt: data.ndaSignedAt ?? current.ndaSignedAt,
			});
		}
		return current;
	});
	ensureTeachizyAfterSignature.mockResolvedValue({ status: 'enqueued' });
});

describe('confirmNdaSignature chain (DocuSeal)', () => {
	it('signe quand le signataire est complété mais la soumission reste awaiting', async () => {
		getSubmission.mockResolvedValue({
			id: 12,
			status: 'awaiting',
			submitters: [{ id: 42, status: 'awaiting', completed_at: '2024-06-01T10:00:00.000Z' }],
		});

		await expect(confirmNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: true,
			followUp: { status: 'enqueued' },
		});

		expect(persistNdaSyncMirror).toHaveBeenCalledWith(
			'enr_1',
			expect.objectContaining({ contractStatus: 'signed' }),
		);
		expect(ensureTeachizyAfterSignature).toHaveBeenCalledWith(
			'enr_1',
			'sync-docuseal:enr_1',
			'sub_12',
		);
	});

	it('interroge GET /submitters quand la soumission omet completed_at', async () => {
		getSubmission.mockResolvedValue({
			id: 12,
			status: 'awaiting',
			submitters: [{ id: 42, status: 'awaiting' }],
		});
		getSubmitter.mockResolvedValue({
			id: 42,
			status: 'awaiting',
			completed_at: '2024-06-01T10:00:00.000Z',
		});

		await expect(confirmNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: true,
			followUp: { status: 'enqueued' },
		});

		expect(getSubmitter).toHaveBeenCalledWith('42');
	});

	it('reste unsigned quand ni soumission ni signataire ne sont complétés', async () => {
		getSubmission.mockResolvedValue({
			id: 12,
			status: 'pending',
			submitters: [{ id: 42, status: 'awaiting' }],
		});

		await expect(confirmNdaSignature('enr_1')).resolves.toEqual({
			ok: true,
			signed: false,
			followUp: { status: 'skipped' },
		});

		expect(persistNdaSyncMirror).toHaveBeenCalledWith(
			'enr_1',
			expect.objectContaining({ contractStatus: 'sent' }),
		);
		expect(ensureTeachizyAfterSignature).not.toHaveBeenCalled();
	});
});
