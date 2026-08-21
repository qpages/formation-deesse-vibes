import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { parseCookie, verifyEnrollmentSessionToken, reconcileEnrollment } = vi.hoisted(() => ({
	parseCookie: vi.fn(),
	verifyEnrollmentSessionToken: vi.fn(),
	reconcileEnrollment: vi.fn(),
}));

vi.mock('../../../../lib/auth/session', () => ({
	parseCookie,
	verifyEnrollmentSessionToken,
	TRACKING_COOKIE: 'dv_enrollment',
}));
vi.mock('../../../../lib/enrollment/reconcile', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../lib/enrollment/reconcile')>();
	return { ...actual, reconcileEnrollment };
});

import { POST } from './refresh';
import {
	RATE_LIMITS,
	enforceRateLimit,
	rateLimitKey,
	resetRateLimitStoreForTests,
} from '../../../../lib/rate-limit';

function refreshNdaSignature(cookie?: string) {
	return POST({
		request: new Request('http://localhost/api/enrollment/nda-signature/refresh', {
			method: 'POST',
			headers: cookie ? { cookie: `dv_enrollment=${cookie}` } : {},
		}),
		clientAddress: '127.0.0.1',
	} as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	vi.clearAllMocks();
	resetRateLimitStoreForTests();
});

afterEach(() => {
	resetRateLimitStoreForTests();
});

describe('POST /api/enrollment/nda-signature/refresh', () => {
	it('sans cookie → 401', async () => {
		parseCookie.mockReturnValue(null);

		const res = await refreshNdaSignature();
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'Session requise.' });
		expect(reconcileEnrollment).not.toHaveBeenCalled();
	});

	it('session invalide → 401', async () => {
		parseCookie.mockReturnValue('bad-token');
		verifyEnrollmentSessionToken.mockResolvedValue(null);

		const res = await refreshNdaSignature('bad-token');
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'Session invalide.' });
	});

	it('signature confirmée → signed true', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'client.nda_sync',
			scope: 'nda_signature',
			steps: [{ step: 'nda_signature', status: 'ok', signed: true }],
			mutated: true,
		});

		const res = await refreshNdaSignature('valid');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, signed: true });
		expect(reconcileEnrollment).toHaveBeenCalledWith('enr_1', 'client.nda_sync', 'nda_signature');
	});

	it('pas encore signé chez le provider → signed false', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'client.nda_sync',
			scope: 'nda_signature',
			steps: [{ step: 'nda_signature', status: 'ok', signed: false }],
			mutated: false,
		});

		const res = await refreshNdaSignature('valid');
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, signed: false });
	});

	it('pas en attente → 409 not_awaiting (reconcile skipped)', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'client.nda_sync',
			scope: 'nda_signature',
			steps: [{ step: 'nda_signature', status: 'skipped', reason: 'not_awaiting' }],
			mutated: false,
		});

		const res = await refreshNdaSignature('valid');
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ reason: 'not_awaiting' });
	});

	it('sans demande NDA → 400 no_nda_request (reconcile skipped)', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'client.nda_sync',
			scope: 'nda_signature',
			steps: [{ step: 'nda_signature', status: 'skipped', reason: 'no_nda_request' }],
			mutated: false,
		});

		const res = await refreshNdaSignature('valid');
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ reason: 'no_nda_request' });
	});

	it('erreur provider → 502', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'client.nda_sync',
			scope: 'nda_signature',
			steps: [{ step: 'nda_signature', status: 'failed', reason: 'provider_error' }],
			mutated: false,
		});

		const res = await refreshNdaSignature('valid');
		expect(res.status).toBe(502);
		expect(await res.json()).toMatchObject({ reason: 'provider_error' });
	});

	it('rate limit → 429', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		const key = rateLimitKey(RATE_LIMITS.ndaSync, ['127.0.0.1', 'enr_1']);
		for (let i = 0; i < RATE_LIMITS.ndaSync.max; i++) {
			expect(enforceRateLimit(key, RATE_LIMITS.ndaSync)).toBeNull();
		}

		const res = await refreshNdaSignature('valid');
		expect(res.status).toBe(429);
		expect(reconcileEnrollment).not.toHaveBeenCalled();
	});
});
