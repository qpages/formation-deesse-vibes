import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	peekMagicLink,
	consumeMagicLink,
	findEnrollmentById,
	reconcileEnrollment,
	resolveAwaitingNdaSignSurface,
	parseCookie,
	verifyEnrollmentSessionToken,
} = vi.hoisted(() => ({
	peekMagicLink: vi.fn(),
	consumeMagicLink: vi.fn(),
	findEnrollmentById: vi.fn(),
	reconcileEnrollment: vi.fn(),
	resolveAwaitingNdaSignSurface: vi.fn(),
	parseCookie: vi.fn(() => null as string | null),
	verifyEnrollmentSessionToken: vi.fn(),
}));

vi.mock('../enrollment', () => ({
	peekMagicLink,
	consumeMagicLink,
	findEnrollmentById,
	findEnrollmentByCheckoutSession: vi.fn(),
	resolveAwaitingNdaSignSurface,
}));

vi.mock('../enrollment/reconcile', () => ({ reconcileEnrollment }));

vi.mock('../payments', () => ({
	getLearnerPaymentSchedule: vi.fn(),
}));

vi.mock('../services/slack', () => ({ notifyOps: vi.fn() }));

vi.mock('../auth/session', () => ({
	createEnrollmentSessionToken: vi.fn(async (id: string) => `jwt:${id}`),
	enrollmentCookieOptions: vi.fn((token: string) => `sid=${token}`),
	parseCookie,
	TRACKING_COOKIE: 'dv_enr',
	verifyEnrollmentSessionToken,
}));

import { completeMagicLinkConsume, resolveHomeEnrollment } from './resolve-home-enrollment';

beforeEach(() => {
	vi.clearAllMocks();
	reconcileEnrollment.mockResolvedValue({
		enrollmentId: 'enr_1',
		trigger: 'page.home',
		scope: 'full',
		steps: [],
		mutated: false,
	});
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

describe('resolveHomeEnrollment reconcile', () => {
	it('awaiting NDA + reconcile mutated signed → enrollment rafraîchi, ndaSignSurface null', async () => {
		const awaiting = {
			id: 'enr_1',
			collectionStatus: 'current',
			contractStatus: 'sent',
			accessStatus: 'not_eligible',
			user: { email: 'a@b.c' },
		};
		const signed = { ...awaiting, contractStatus: 'signed' as const };

		parseCookie.mockReturnValue('session-token');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		findEnrollmentById.mockResolvedValueOnce(awaiting).mockResolvedValueOnce(signed);
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'page.home',
			scope: 'full',
			steps: [{ step: 'nda_signature', status: 'ok', signed: true }],
			mutated: true,
		});

		const result = await resolveHomeEnrollment({
			cookieHeader: 'dv_enr=session-token',
			token: null,
			sessionId: null,
			checkout: null,
			connected: null,
			link: null,
		});

		expect(result.kind).toBe('page');
		if (result.kind !== 'page') return;
		expect(reconcileEnrollment).toHaveBeenCalledWith(
			'enr_1',
			{ source: 'page.home', sessionId: null },
			'full',
		);
		expect(result.view.enrollment?.contractStatus).toBe('signed');
		expect(result.view.ndaSignSurface).toBeNull();
		expect(resolveAwaitingNdaSignSurface).not.toHaveBeenCalled();
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
