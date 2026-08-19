import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEnrollmentById, applyAccessPolicy, sendInngestSafe } = vi.hoisted(() => ({
	findEnrollmentById: vi.fn(),
	applyAccessPolicy: vi.fn(),
	sendInngestSafe: vi.fn(),
}));

vi.mock('../services/enrollment', () => ({ findEnrollmentById }));
vi.mock('../services/access', () => ({ applyAccessPolicy }));
vi.mock('../inngest/client', () => ({ sendInngestSafe }));

import { ensureTeachizyAfterSignature } from './after-signature';

beforeEach(() => {
	vi.clearAllMocks();
	sendInngestSafe.mockResolvedValue({ status: 'enqueued' });
	applyAccessPolicy.mockResolvedValue(undefined);
});

describe('ensureTeachizyAfterSignature', () => {
	it('dual-emit nda/signature.completed et yousign/signature.done', async () => {
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			contractStatus: 'signed',
			teachizyInvitedAt: null,
			accessStatus: 'pending',
		});

		await ensureTeachizyAfterSignature('enr_1', 'evt_src', 'req_1');

		expect(sendInngestSafe).toHaveBeenCalledTimes(2);
		expect(sendInngestSafe).toHaveBeenCalledWith({
			id: 'teachizy-after-signature:yousign:enr_1',
			name: 'yousign/signature.done',
			data: {
				enrollmentId: 'enr_1',
				yousignEventId: 'evt_src',
				requestId: 'req_1',
			},
		});
		expect(sendInngestSafe).toHaveBeenCalledWith({
			id: 'teachizy-after-signature:nda:enr_1',
			name: 'nda/signature.completed',
			data: {
				enrollmentId: 'enr_1',
				providerEventId: 'evt_src',
				requestId: 'req_1',
			},
		});
	});

	it('skip si déjà invité et actif', async () => {
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			contractStatus: 'signed',
			teachizyInvitedAt: new Date(),
			accessStatus: 'active',
		});

		const result = await ensureTeachizyAfterSignature('enr_1', 'evt_src', 'req_1');

		expect(result).toEqual({ status: 'skipped' });
		expect(sendInngestSafe).not.toHaveBeenCalled();
	});

	it('docuseal: émet uniquement nda/signature.completed', async () => {
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			contractStatus: 'signed',
			teachizyInvitedAt: null,
			accessStatus: 'pending',
		});

		await ensureTeachizyAfterSignature('enr_1', 'evt_src', 'req_1', { provider: 'docuseal' });

		expect(sendInngestSafe).toHaveBeenCalledTimes(1);
		expect(sendInngestSafe).toHaveBeenCalledWith({
			id: 'teachizy-after-signature:nda:enr_1',
			name: 'nda/signature.completed',
			data: {
				enrollmentId: 'enr_1',
				providerEventId: 'evt_src',
				requestId: 'req_1',
			},
		});
	});
});
