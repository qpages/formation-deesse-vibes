import { beforeEach, describe, expect, it, vi } from 'vitest';

const { peekMagicLink, consumeMagicLink, findEnrollmentById } = vi.hoisted(() => ({
	peekMagicLink: vi.fn(),
	consumeMagicLink: vi.fn(),
	findEnrollmentById: vi.fn(),
}));

vi.mock('../services/enrollment', () => ({
	peekMagicLink,
	consumeMagicLink,
	findEnrollmentById,
	findEnrollmentByCheckoutSession: vi.fn(),
	resolveNdaSignSurface: vi.fn(),
}));

vi.mock('../services/payments', () => ({
	confirmPaidCheckout: vi.fn(),
	ensureNdaAfterPayment: vi.fn(),
	listPaidInvoiceLinks: vi.fn(),
	retrieveCheckoutSession: vi.fn(),
}));

vi.mock('../services/slack', () => ({ notifyOps: vi.fn() }));

vi.mock('../auth/session', () => ({
	createEnrollmentSessionToken: vi.fn(async (id: string) => `jwt:${id}`),
	enrollmentCookieOptions: vi.fn((token: string) => `sid=${token}`),
	parseCookie: vi.fn(() => null),
	TRACKING_COOKIE: 'dv_enr',
	verifyEnrollmentSessionToken: vi.fn(),
}));

import { completeMagicLinkConsume, resolveHomeEnrollment } from './resolve-home-enrollment';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('resolveHomeEnrollment GET ?token=', () => {
	it('token unused → confirm, sans consume', async () => {
		peekMagicLink.mockResolvedValue({ status: 'unused', enrollmentId: 'enr_1' });

		const result = await resolveHomeEnrollment({
			cookieHeader: null,
			token: 'tok',
			sessionId: null,
			checkout: null,
			connected: null,
			link: null,
		});

		expect(result).toEqual({ kind: 'confirm_magic_link', token: 'tok' });
		expect(consumeMagicLink).not.toHaveBeenCalled();
	});

	it('token invalid → redirect, sans consume', async () => {
		peekMagicLink.mockResolvedValue({ status: 'invalid' });

		const result = await resolveHomeEnrollment({
			cookieHeader: null,
			token: 'tok',
			sessionId: null,
			checkout: null,
			connected: null,
			link: null,
		});

		expect(result).toEqual({
			kind: 'redirect',
			redirectTo: '/?link=invalid#acces',
			setCookie: null,
		});
		expect(consumeMagicLink).not.toHaveBeenCalled();
	});
});

describe('completeMagicLinkConsume POST', () => {
	it('consomme une fois puis pose le cookie', async () => {
		consumeMagicLink.mockResolvedValue({ status: 'unused', enrollmentId: 'enr_1' });
		findEnrollmentById.mockResolvedValue({
			id: 'enr_1',
			user: { email: 'a@b.c' },
		});

		await expect(completeMagicLinkConsume('tok', null)).resolves.toEqual({
			redirectTo: '/?connected=1#acces',
			setCookie: 'sid=jwt:enr_1',
		});
		expect(consumeMagicLink).toHaveBeenCalledWith('tok');
	});
});
