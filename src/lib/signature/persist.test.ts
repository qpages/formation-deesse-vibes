import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPrisma } = vi.hoisted(() => ({
	getPrisma: vi.fn(),
}));

vi.mock('../prisma', () => ({ getPrisma }));

import {
	findEnrollmentByExternalRequestId,
	findEnrollmentByExternalRequestOrEnrollmentId,
} from '../services/enrollment-queries';

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
