import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
	getEnv: () => ({ SIGNATURE_PROVIDER: 'docuseal' }),
}));

const { getPrisma } = vi.hoisted(() => ({
	getPrisma: vi.fn(),
}));

vi.mock('../prisma', () => ({ getPrisma }));

import { persistNdaDraftRequestId, persistNdaProvisioned } from './persist';

describe('persist DocuSeal', () => {
	it('persistNdaDraftRequestId écrit nda_requests docuseal sans yousignRequestId', async () => {
		const upsert = vi.fn();
		const update = vi.fn();
		const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: 'enr_1' });
		getPrisma.mockReturnValue({
			$transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
				fn({
					ndaRequest: { upsert },
					enrollment: { findUniqueOrThrow, update },
				}),
		});

		await persistNdaDraftRequestId('enr_1', 'sub_12');

		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					provider: 'docuseal',
					externalRequestId: 'sub_12',
					signKind: 'embed',
				}),
			}),
		);
		expect(update).not.toHaveBeenCalled();
	});

	it('persistNdaProvisioned stocke embed_src en metadata', async () => {
		const upsert = vi.fn();
		const update = vi.fn().mockResolvedValue({ id: 'enr_1' });
		getPrisma.mockReturnValue({
			$transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
				fn({
					ndaRequest: { upsert },
					enrollment: { update },
				}),
		});

		await persistNdaProvisioned('enr_1', {
			requestId: 'sub_12',
			signerId: '42',
			signatureLink: 'https://docuseal.com/s/abc',
		});

		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					provider: 'docuseal',
					metadata: { embed_src: 'https://docuseal.com/s/abc' },
				}),
			}),
		);
	});
});
