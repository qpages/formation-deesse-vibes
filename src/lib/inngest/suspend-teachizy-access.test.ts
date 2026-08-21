import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	findEnrollmentByIdOrThrow: vi.fn(),
	blockTeachizyCustomer: vi.fn(),
	sendPastDueSuspensionEmail: vi.fn(),
	notifyOps: vi.fn(),
	isTeachizyConfigured: vi.fn(() => true),
}));

vi.mock('../enrollment', () => ({ findEnrollmentByIdOrThrow: mocks.findEnrollmentByIdOrThrow }));
vi.mock('../teachizy', () => ({
	blockTeachizyCustomer: mocks.blockTeachizyCustomer,
	isTeachizyConfigured: mocks.isTeachizyConfigured,
}));
vi.mock('../services/brevo', () => ({
	sendPastDueSuspensionEmail: mocks.sendPastDueSuspensionEmail,
}));
vi.mock('../services/slack', () => ({
	alertFinalFailure: vi.fn(),
	formatErrorDetail: vi.fn(),
	notifyOps: mocks.notifyOps,
	withJobLifecycleAlerts: vi.fn(({ run }: { run: () => Promise<unknown> }) => run()),
}));

import { handleSuspendTeachizyAccess, suspendTeachizyAccess } from './suspend-teachizy-access';

const enrollment = {
	id: 'enr_1',
	accessStatus: 'suspended' as const,
	user: { email: 'user@example.com', firstName: 'Camille', lastName: 'Martin' },
};

function invokeSuspend() {
	return handleSuspendTeachizyAccess({
		event: {
			data: { enrollmentId: 'enr_1' },
		},
		step: {
			run: async <T>(_id: string, fn: () => T | Promise<T>) => fn(),
		},
		attempt: 0,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findEnrollmentByIdOrThrow.mockResolvedValue(enrollment);
	mocks.sendPastDueSuspensionEmail.mockResolvedValue(undefined);
	mocks.notifyOps.mockResolvedValue(undefined);
});

describe('suspendTeachizyAccess', () => {
	it('déclenche sur enrollment/access.suspend', () => {
		const config = suspendTeachizyAccess.opts as { triggers: Array<{ event: string }> };
		expect(config.triggers.map((t) => t.event)).toContain('enrollment/access.suspend');
	});

	it('envoie l’e-mail impayé si le client existe sur Teachizy', async () => {
		mocks.blockTeachizyCustomer.mockResolvedValue('blocked');

		const result = await invokeSuspend();

		expect(mocks.sendPastDueSuspensionEmail).toHaveBeenCalledWith({
			to: 'user@example.com',
			firstName: 'Camille',
		});
		expect(result).toMatchObject({ blockResult: 'blocked', emailSent: true });
	});

	it('n’envoie pas l’e-mail si le client n’est pas sur Teachizy', async () => {
		mocks.blockTeachizyCustomer.mockResolvedValue('not_found');

		const result = await invokeSuspend();

		expect(mocks.sendPastDueSuspensionEmail).not.toHaveBeenCalled();
		expect(mocks.notifyOps).toHaveBeenCalledWith(
			expect.objectContaining({
				detail: expect.stringContaining('e-mail impayé non envoyé'),
			}),
		);
		expect(result).toMatchObject({ blockResult: 'not_found', emailSent: false });
	});
});
