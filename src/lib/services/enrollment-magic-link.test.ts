import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, update, getPrisma } = vi.hoisted(() => {
	const findUnique = vi.fn();
	const update = vi.fn();
	return {
		findUnique,
		update,
		getPrisma: vi.fn(() => ({ magicLink: { findUnique, update } })),
	};
});

vi.mock('../prisma', () => ({ getPrisma }));
vi.mock('../yousign', () => ({ getSignatureLink: vi.fn() }));
vi.mock('./brevo', () => ({ sendMagicLinkEmail: vi.fn() }));

import { hashToken } from '../crypto';
import { consumeMagicLink } from './enrollment';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('consumeMagicLink', () => {
	it('token inconnu → invalid, pas d’update', async () => {
		findUnique.mockResolvedValue(null);

		await expect(consumeMagicLink('tok')).resolves.toEqual({ status: 'invalid' });
		expect(update).not.toHaveBeenCalled();
	});

	it('token déjà utilisé → used + enrollmentId, pas de second consume', async () => {
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
		expect(update).not.toHaveBeenCalled();
	});

	it('token expiré non utilisé → invalid', async () => {
		findUnique.mockResolvedValue({
			id: 'ml_1',
			enrollmentId: 'enr_1',
			usedAt: null,
			expiresAt: new Date(Date.now() - 1000),
		});

		await expect(consumeMagicLink('tok')).resolves.toEqual({ status: 'invalid' });
		expect(update).not.toHaveBeenCalled();
	});

	it('token valide → consume usedAt + unused', async () => {
		findUnique.mockResolvedValue({
			id: 'ml_1',
			enrollmentId: 'enr_1',
			usedAt: null,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
		});
		update.mockResolvedValue({});

		await expect(consumeMagicLink('tok')).resolves.toEqual({
			status: 'unused',
			enrollmentId: 'enr_1',
		});
		expect(findUnique).toHaveBeenCalledWith({
			where: { tokenHash: hashToken('tok') },
		});
		expect(update).toHaveBeenCalledWith({
			where: { id: 'ml_1' },
			data: { usedAt: expect.any(Date) },
		});
	});
});
