import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncNdaStatus } = vi.hoisted(() => ({
	syncNdaStatus: vi.fn(),
}));

vi.mock('../signature/sync-nda', () => ({ syncNdaStatus }));
vi.mock('../enrollment', () => ({
	canResendNda: vi.fn(),
	findEnrollmentById: vi.fn(),
}));
vi.mock('../payments', () => ({ syncPaymentFromStripe: vi.fn() }));
vi.mock('../services/teachizy-access', () => ({ syncTeachizyAccess: vi.fn() }));
vi.mock('../services/slack', () => ({ notifyOps: vi.fn() }));
vi.mock('../inngest/client', () => ({ sendInngestSafe: vi.fn() }));
vi.mock('../signature/factory', () => ({ getSignaturePort: vi.fn() }));

import { getSignaturePort } from '../signature/factory';
import { dispatchAdminAction } from './dispatch';

const enrollment = { id: 'enr_1' } as Parameters<typeof dispatchAdminAction>[1];

beforeEach(() => {
	vi.clearAllMocks();
});

describe('dispatchAdminAction sync NDA', () => {
	it('sync_nda appelle syncNdaStatus', async () => {
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'ongoing',
			followUp: { status: 'skipped' },
		});

		const result = await dispatchAdminAction('sync_nda', enrollment);

		expect(syncNdaStatus).toHaveBeenCalledWith('enr_1');
		expect(result).toEqual({ ok: true });
	});
});

describe('dispatchAdminAction copy_nda_link', () => {
	it('refuse embed', async () => {
		const result = await dispatchAdminAction('copy_nda_link', {
			...enrollment,
			ndaRequest: {
				provider: 'docuseal',
				externalRequestId: 'req_1',
				externalSignerId: 'sig_1',
				signKind: 'embed',
			},
		} as Parameters<typeof dispatchAdminAction>[1]);

		expect(result).toEqual({
			ok: false,
			error: 'Signature intégrée (embed) — pas de lien à copier.',
			status: 400,
		});
	});

	it('copie le lien redirect', async () => {
		vi.mocked(getSignaturePort).mockReturnValue({
			getSignSurface: vi.fn().mockResolvedValue({
				kind: 'redirect',
				url: 'https://sign.example',
			}),
		} as ReturnType<typeof getSignaturePort>);

		const result = await dispatchAdminAction('copy_nda_link', {
			...enrollment,
			ndaRequest: {
				provider: 'yousign',
				externalRequestId: 'req_1',
				externalSignerId: 'sig_1',
				signKind: 'redirect',
			},
		} as Parameters<typeof dispatchAdminAction>[1]);

		expect(result).toEqual({
			ok: true,
			message: 'Lien copié dans le presse-papiers.',
			copyUrl: 'https://sign.example',
		});
	});
});
