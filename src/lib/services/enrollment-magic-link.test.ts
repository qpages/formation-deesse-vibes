import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, updateMany, getPrisma } = vi.hoisted(() => {
	const findUnique = vi.fn();
	const updateMany = vi.fn();
	return {
		findUnique,
		updateMany,
		getPrisma: vi.fn(() => ({ magicLink: { findUnique, updateMany } })),
	};
});

vi.mock('../prisma', () => ({ getPrisma }));
vi.mock('./brevo', () => ({ sendMagicLinkEmail: vi.fn() }));

import { hashToken } from '../crypto';
import { consumeMagicLink, peekMagicLink } from './enrollment';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('peekMagicLink', () => {
	it('token valide → unused, aucun write', async () => {
		findUnique.mockResolvedValue({
			id: 'ml_1',
			enrollmentId: 'enr_1',
			usedAt: null,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
		});

		await expect(peekMagicLink('tok')).resolves.toEqual({
			status: 'unused',
			enrollmentId: 'enr_1',
		});
		expect(updateMany).not.toHaveBeenCalled();
	});
});

describe('consumeMagicLink', () => {
	it('token inconnu → invalid, pas d’update', async () => {
		updateMany.mockResolvedValue({ count: 0 });
		findUnique.mockResolvedValue(null);

		await expect(consumeMagicLink('tok')).resolves.toEqual({ status: 'invalid' });
		expect(updateMany).toHaveBeenCalledWith({
			where: {
				tokenHash: hashToken('tok'),
				usedAt: null,
				expiresAt: { gt: expect.any(Date) },
			},
			data: { usedAt: expect.any(Date) },
		});
	});

	it('token déjà utilisé → used + enrollmentId, count 0', async () => {
		updateMany.mockResolvedValue({ count: 0 });
		findUnique.mockResolvedValue({
			id: 'ml_1',
			enrollmentId: 'enr_1',
			usedAt: new Date(),
			expiresAt: new Date(Date.now() - 60_000),
		});

		await expect(consumeMagicLink('tok')).resolves.toEqual({
			status: 'used',
			enrollmentId: 'enr_1',
		});
	});

	it('token expiré non utilisé → invalid', async () => {
		updateMany.mockResolvedValue({ count: 0 });
		findUnique.mockResolvedValue({
			id: 'ml_1',
			enrollmentId: 'enr_1',
			usedAt: null,
			expiresAt: new Date(Date.now() - 1000),
		});

		await expect(consumeMagicLink('tok')).resolves.toEqual({ status: 'invalid' });
	});

	it('token valide → consume usedAt + unused', async () => {
		updateMany.mockResolvedValue({ count: 1 });
		findUnique.mockResolvedValue({
			id: 'ml_1',
			enrollmentId: 'enr_1',
			usedAt: new Date(),
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
		});

		await expect(consumeMagicLink('tok')).resolves.toEqual({
			status: 'unused',
			enrollmentId: 'enr_1',
		});
		expect(updateMany).toHaveBeenCalled();
	});
});
