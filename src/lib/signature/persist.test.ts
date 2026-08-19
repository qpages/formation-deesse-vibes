import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPrisma } = vi.hoisted(() => ({
	getPrisma: vi.fn(),
}));

vi.mock('../env', () => ({
	getEnv: () => ({ SIGNATURE_PROVIDER: 'yousign' }),
}));
vi.mock('../prisma', () => ({ getPrisma }));

import {
	findEnrollmentByExternalRequestId,
	findEnrollmentByExternalRequestOrEnrollmentId,
} from '../services/enrollment-queries';
import {
	clearNdaFields,
	persistNdaDraftRequestId,
	persistNdaProvisioned,
	recordNdaError,
} from './persist';

const enrollment = { id: 'enr_1', user: { email: 'a@b.c' } };

beforeEach(() => {
	vi.clearAllMocks();
});

describe('findEnrollmentByExternalRequestId', () => {
	it('returns enrollment resolved via nda_requests', async () => {
		const findFirst = vi.fn().mockResolvedValue(enrollment);
		const findUnique = vi.fn();
		getPrisma.mockReturnValue({ enrollment: { findFirst, findUnique } });

		await expect(findEnrollmentByExternalRequestId('yousign', 'req_nda')).resolves.toBe(enrollment);

		expect(findFirst).toHaveBeenCalledWith({
			where: { ndaRequest: { provider: 'yousign', externalRequestId: 'req_nda' } },
			include: { user: true, ndaRequest: true },
		});
		expect(findUnique).not.toHaveBeenCalled();
	});

	it('falls back to enrollment.yousignRequestId', async () => {
		const findFirst = vi.fn().mockResolvedValue(null);
		const findUnique = vi.fn().mockResolvedValue(enrollment);
		getPrisma.mockReturnValue({ enrollment: { findFirst, findUnique } });

		await expect(findEnrollmentByExternalRequestId('yousign', 'req_legacy')).resolves.toBe(
			enrollment,
		);

		expect(findUnique).toHaveBeenCalledWith({
			where: { yousignRequestId: 'req_legacy' },
			include: { user: true, ndaRequest: true },
		});
	});
});

describe('findEnrollmentByExternalRequestOrEnrollmentId', () => {
	it('queries nda_requests, yousignRequestId and enrollment id', async () => {
		const findFirst = vi.fn().mockResolvedValue(enrollment);
		getPrisma.mockReturnValue({ enrollment: { findFirst } });

		await expect(
			findEnrollmentByExternalRequestOrEnrollmentId('yousign', 'req_1', 'enr_1'),
		).resolves.toBe(enrollment);

		expect(findFirst).toHaveBeenCalledWith({
			where: {
				OR: [
					{ ndaRequest: { provider: 'yousign', externalRequestId: 'req_1' } },
					{ yousignRequestId: 'req_1' },
					{ id: 'enr_1' },
				],
			},
			include: { user: true, ndaRequest: true },
		});
	});
});

function mockTransaction() {
	const upsert = vi.fn();
	const update = vi.fn().mockResolvedValue(enrollment);
	const findUniqueOrThrow = vi.fn().mockResolvedValue(enrollment);
	const deleteMany = vi.fn();
	const ndaUpdateMany = vi.fn();
	const enrollmentUpdateMany = vi.fn();

	getPrisma.mockReturnValue({
		$transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
			fn({
				ndaRequest: { upsert, deleteMany, updateMany: ndaUpdateMany },
				enrollment: { update, findUniqueOrThrow, updateMany: enrollmentUpdateMany },
			}),
	});

	return { upsert, update, findUniqueOrThrow, deleteMany, ndaUpdateMany, enrollmentUpdateMany };
}

describe('YouSign persist dual-write', () => {
	it('persistNdaDraftRequestId écrit yousignRequestId + nda_requests', async () => {
		const { upsert, update } = mockTransaction();

		await persistNdaDraftRequestId('enr_1', 'req_draft');

		expect(update).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: { yousignRequestId: 'req_draft' },
			include: { user: true, ndaRequest: true },
		});
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { enrollmentId: 'enr_1' },
				create: expect.objectContaining({
					provider: 'yousign',
					externalRequestId: 'req_draft',
					signKind: 'redirect',
				}),
			}),
		);
	});

	it('persistNdaProvisioned dual-write enrollment yousign* + nda_requests', async () => {
		const { upsert, update } = mockTransaction();

		await persistNdaProvisioned('enr_1', {
			requestId: 'req_1',
			signerId: 'sig_1',
			signatureLink: 'https://sign',
		});

		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'enr_1' },
				data: expect.objectContaining({
					yousignRequestId: 'req_1',
					yousignSignerId: 'sig_1',
					yousignStatus: 'ongoing',
					contractStatus: 'sent',
				}),
			}),
		);
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					provider: 'yousign',
					externalRequestId: 'req_1',
					externalSignerId: 'sig_1',
				}),
			}),
		);
	});

	it('clearNdaFields supprime nda_requests et remet yousign* à null', async () => {
		const { deleteMany, update } = mockTransaction();

		await clearNdaFields('enr_1');

		expect(deleteMany).toHaveBeenCalledWith({ where: { enrollmentId: 'enr_1' } });
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'enr_1' },
				data: expect.objectContaining({
					yousignRequestId: null,
					yousignSignerId: null,
					yousignStatus: null,
					contractStatus: 'pending',
				}),
			}),
		);
	});

	it('recordNdaError dual-write yousignLastError + nda_requests.lastError', async () => {
		const { update, ndaUpdateMany } = mockTransaction();

		await recordNdaError('enr_1', 'provision failed');

		expect(update).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: expect.objectContaining({
				yousignLastError: 'provision failed',
				yousignLastErrorAt: expect.any(Date),
			}),
		});
		expect(ndaUpdateMany).toHaveBeenCalledWith({
			where: { enrollmentId: 'enr_1' },
			data: expect.objectContaining({
				lastError: 'provision failed',
				lastErrorAt: expect.any(Date),
			}),
		});
	});
});
