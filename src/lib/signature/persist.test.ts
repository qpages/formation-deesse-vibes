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
} from '../enrollment/queries';
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
		getPrisma.mockReturnValue({ enrollment: { findFirst } });

		await expect(findEnrollmentByExternalRequestId('yousign', 'req_nda')).resolves.toBe(enrollment);

		expect(findFirst).toHaveBeenCalledWith({
			where: { ndaRequest: { provider: 'yousign', externalRequestId: 'req_nda' } },
			include: { user: true, ndaRequest: true },
		});
	});

	it('returns null when nda_requests has no match', async () => {
		const findFirst = vi.fn().mockResolvedValue(null);
		getPrisma.mockReturnValue({ enrollment: { findFirst } });

		await expect(findEnrollmentByExternalRequestId('yousign', 'req_missing')).resolves.toBeNull();
	});
});

describe('findEnrollmentByExternalRequestOrEnrollmentId', () => {
	it('queries nda_requests and enrollment id', async () => {
		const findFirst = vi.fn().mockResolvedValue(enrollment);
		getPrisma.mockReturnValue({ enrollment: { findFirst } });

		await expect(
			findEnrollmentByExternalRequestOrEnrollmentId('yousign', 'req_1', 'enr_1'),
		).resolves.toBe(enrollment);

		expect(findFirst).toHaveBeenCalledWith({
			where: {
				OR: [
					{ ndaRequest: { provider: 'yousign', externalRequestId: 'req_1' } },
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

describe('NDA persist (nda_requests only)', () => {
	it('persistNdaDraftRequestId écrit nda_requests', async () => {
		const { upsert, update } = mockTransaction();

		await persistNdaDraftRequestId('enr_1', 'req_draft');

		expect(update).not.toHaveBeenCalled();
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

	it('persistNdaProvisioned écrit enrollment contractStatus + nda_requests', async () => {
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

	it('clearNdaFields supprime nda_requests et remet contractStatus à pending', async () => {
		const { deleteMany, update } = mockTransaction();

		await clearNdaFields('enr_1');

		expect(deleteMany).toHaveBeenCalledWith({ where: { enrollmentId: 'enr_1' } });
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'enr_1' },
				data: expect.objectContaining({
					contractStatus: 'pending',
				}),
			}),
		);
	});

	it('recordNdaError écrit nda_requests.lastError + contractStatus error', async () => {
		const { ndaUpdateMany, enrollmentUpdateMany } = mockTransaction();

		await recordNdaError('enr_1', 'provision failed');

		expect(enrollmentUpdateMany).toHaveBeenCalledWith({
			where: { id: 'enr_1', contractStatus: 'pending' },
			data: { contractStatus: 'error' },
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
