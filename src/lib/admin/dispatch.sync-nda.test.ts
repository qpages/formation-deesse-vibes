import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncNdaStatus } = vi.hoisted(() => ({
	syncNdaStatus: vi.fn(),
}));

vi.mock('../signature/sync-nda', () => ({ syncNdaStatus }));
vi.mock('../services/enrollment', () => ({
	canResendNda: vi.fn(),
	findEnrollmentById: vi.fn(),
}));
vi.mock('../services/payments', () => ({ syncPaymentFromStripe: vi.fn() }));
vi.mock('../services/teachizy-access', () => ({ syncTeachizyAccess: vi.fn() }));
vi.mock('../services/slack', () => ({ notifyOps: vi.fn() }));
vi.mock('../inngest/client', () => ({ sendInngestSafe: vi.fn() }));
vi.mock('../signature/factory', () => ({ getSignaturePort: vi.fn() }));

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

	it('sync_yousign est un alias de sync_nda', async () => {
		syncNdaStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'done',
			followUp: { status: 'enqueued' },
		});

		await dispatchAdminAction('sync_yousign', enrollment);

		expect(syncNdaStatus).toHaveBeenCalledWith('enr_1');
	});
});
