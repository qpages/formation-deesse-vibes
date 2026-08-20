import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEnv, getPrisma } = vi.hoisted(() => ({
	getEnv: vi.fn(() => ({ SIGNATURE_PROVIDER: 'docuseal' })),
	getPrisma: vi.fn(),
}));

vi.mock('../env', () => ({ getEnv }));
vi.mock('../prisma', () => ({ getPrisma }));

import { persistNdaDraftRequestId, persistNdaProvisioned } from './persist';

function mockTransaction() {
	const upsert = vi.fn();
	const update = vi.fn().mockResolvedValue({ id: 'enr_1' });
	const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: 'enr_1' });
	getPrisma.mockReturnValue({
		$transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
			fn({
				ndaRequest: { upsert },
				enrollment: { findUniqueOrThrow, update },
			}),
	});
	return { upsert, update, findUniqueOrThrow };
}

beforeEach(() => {
	vi.clearAllMocks();
	getEnv.mockReturnValue({ SIGNATURE_PROVIDER: 'docuseal' });
});

describe('persist DocuSeal embed', () => {
	it('persistNdaDraftRequestId écrit nda_requests docuseal embed', async () => {
		const { upsert, update } = mockTransaction();

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
		const { upsert } = mockTransaction();

		await persistNdaProvisioned('enr_1', {
			requestId: 'sub_12',
			signerId: '42',
			signatureLink: 'https://docuseal.eu/s/abc',
		});

		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					provider: 'docuseal',
					signKind: 'embed',
					metadata: { embed_src: 'https://docuseal.eu/s/abc' },
				}),
			}),
		);
	});
});

describe('persist DocuSeal redirect', () => {
	it('persistNdaProvisioned redirect sans metadata embed_src', async () => {
		getEnv.mockReturnValue({
			SIGNATURE_PROVIDER: 'docuseal',
			SIGNATURE_MODE: 'redirect',
		} as ReturnType<typeof getEnv>);
		const { upsert } = mockTransaction();

		await persistNdaProvisioned('enr_1', {
			requestId: 'sub_12',
			signerId: '42',
			signatureLink: 'https://docuseal.eu/s/abc',
		});

		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					signKind: 'redirect',
					metadata: undefined,
				}),
			}),
		);
	});
});
