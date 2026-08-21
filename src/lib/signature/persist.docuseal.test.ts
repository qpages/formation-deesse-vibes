import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPrisma, findEnrollmentById } = vi.hoisted(() => ({
	getPrisma: vi.fn(),
	findEnrollmentById: vi.fn(),
}));

vi.mock('../prisma', () => ({ getPrisma }));
vi.mock('../enrollment/queries', () => ({
	findEnrollmentById,
	withUser: { include: { user: true, ndaRequest: true } },
}));

import { ensureNdaContractSentIfProvisioned, persistNdaDraftRequestId, persistNdaProvisioned } from './persist';

const docusealEmbed = { provider: 'docuseal' as const, signKind: 'embed' as const };
const docusealRedirect = { provider: 'docuseal' as const, signKind: 'redirect' as const };

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
		enrollment: { update: vi.fn().mockResolvedValue({ id: 'enr_1' }) },
	});
	return { upsert, update, findUniqueOrThrow };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('persist DocuSeal embed', () => {
	it('persistNdaDraftRequestId écrit nda_requests docuseal embed', async () => {
		const { upsert, update } = mockTransaction();

		await persistNdaDraftRequestId('enr_1', 'sub_12', docusealEmbed);

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
		}, docusealEmbed);

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
		const { upsert } = mockTransaction();

		await persistNdaProvisioned('enr_1', {
			requestId: 'sub_12',
			signerId: '42',
			signatureLink: 'https://docuseal.eu/s/abc',
		}, docusealRedirect);

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

describe('ensureNdaContractSentIfProvisioned', () => {
	it('aligne contractStatus sent quand le NDA est provisionné', async () => {
		const enrollmentUpdate = vi.fn().mockResolvedValue({ id: 'enr_1' });
		getPrisma.mockReturnValue({ enrollment: { update: enrollmentUpdate } });
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			contractStatus: 'sent',
			ndaRequest: { externalRequestId: 'sub_1', externalSignerId: '42' },
			user: { email: 'a@b.c' },
		});

		const enrollment = {
			id: 'enr_1',
			contractStatus: 'pending' as const,
			ndaRequest: { externalRequestId: 'sub_1', externalSignerId: '42', provider: 'docuseal' as const },
			user: { email: 'a@b.c' },
		} as unknown as Parameters<typeof ensureNdaContractSentIfProvisioned>[0];

		const result = await ensureNdaContractSentIfProvisioned(enrollment);

		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: { contractStatus: 'sent' },
		});
		expect(result.contractStatus).toBe('sent');
	});

	it('no-op si le contrat est déjà envoyé', async () => {
		const enrollmentUpdate = vi.fn();
		getPrisma.mockReturnValue({ enrollment: { update: enrollmentUpdate } });

		const enrollment = {
			id: 'enr_1',
			contractStatus: 'sent' as const,
			ndaRequest: { externalRequestId: 'sub_1', externalSignerId: '42', provider: 'docuseal' as const },
			user: { email: 'a@b.c' },
		} as unknown as Parameters<typeof ensureNdaContractSentIfProvisioned>[0];

		await ensureNdaContractSentIfProvisioned(enrollment);

		expect(enrollmentUpdate).not.toHaveBeenCalled();
	});
});
