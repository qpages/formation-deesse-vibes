import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	parseCookie,
	verifyEnrollmentSessionToken,
	reconcileEnrollment,
	findEnrollmentById,
	buildEnrollmentStatusPayload,
} = vi.hoisted(() => ({
	parseCookie: vi.fn(),
	verifyEnrollmentSessionToken: vi.fn(),
	reconcileEnrollment: vi.fn(),
	findEnrollmentById: vi.fn(),
	buildEnrollmentStatusPayload: vi.fn(),
}));

vi.mock('../../../lib/auth/session', () => ({
	parseCookie,
	verifyEnrollmentSessionToken,
	TRACKING_COOKIE: 'dv_enrollment',
}));
vi.mock('../../../lib/enrollment', () => ({ findEnrollmentById }));
vi.mock('../../../lib/enrollment/status-payload', () => ({ buildEnrollmentStatusPayload }));
vi.mock('../../../lib/enrollment/reconcile', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../lib/enrollment/reconcile')>();
	return { ...actual, reconcileEnrollment };
});

import { POST } from './reconcile';
import {
	RATE_LIMITS,
	enforceRateLimit,
	rateLimitKey,
	resetRateLimitStoreForTests,
} from '../../../lib/rate-limit';

function postReconcile(cookie?: string) {
	return POST({
		request: new Request('http://localhost/api/enrollment/reconcile', {
			method: 'POST',
			headers: cookie ? { cookie: `dv_enrollment=${cookie}` } : {},
		}),
		clientAddress: '127.0.0.1',
	} as Parameters<typeof POST>[0]);
}

const PAYLOAD = {
	collectionStatus: 'paid',
	contractStatus: 'sent',
	accessStatus: 'not_eligible',
	hasSignSurface: true,
	signSurfaceKind: 'redirect',
	fingerprint: 'paid|sent|not_eligible',
	poll: true,
	hasCheckoutSession: true,
	view: {},
};

beforeEach(() => {
	vi.clearAllMocks();
	resetRateLimitStoreForTests();
});

afterEach(() => {
	resetRateLimitStoreForTests();
});

describe('POST /api/enrollment/reconcile', () => {
	it('sans cookie → 401 (aucune réconciliation)', async () => {
		parseCookie.mockReturnValue(null);

		const res = await postReconcile();
		expect(res.status).toBe(401);
		expect(reconcileEnrollment).not.toHaveBeenCalled();
	});

	it('session invalide → 401', async () => {
		parseCookie.mockReturnValue('bad');
		verifyEnrollmentSessionToken.mockResolvedValue(null);

		const res = await postReconcile('bad');
		expect(res.status).toBe(401);
		expect(reconcileEnrollment).not.toHaveBeenCalled();
	});

	it('rejoue la réconciliation full et renvoie le statut à jour (symptôme A)', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'client.status_poll',
			scope: 'full',
			steps: [{ step: 'payment', status: 'ok', alreadyConfirmed: false }],
			mutated: true,
		});
		findEnrollmentById.mockResolvedValue({ id: 'enr_1' });
		buildEnrollmentStatusPayload.mockResolvedValue(PAYLOAD);

		const res = await postReconcile('valid');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(PAYLOAD);
		expect(reconcileEnrollment).toHaveBeenCalledWith('enr_1', 'client.status_poll', 'full');
	});

	it('renvoie quand même le statut si la réconciliation échoue (best-effort)', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		reconcileEnrollment.mockRejectedValue(new Error('Stripe indisponible'));
		findEnrollmentById.mockResolvedValue({ id: 'enr_1' });
		buildEnrollmentStatusPayload.mockResolvedValue(PAYLOAD);

		const res = await postReconcile('valid');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(PAYLOAD);
	});

	it('rate limit → 429 (aucune réconciliation)', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		const key = rateLimitKey(RATE_LIMITS.statusPoll, ['127.0.0.1', 'enr_1']);
		for (let i = 0; i < RATE_LIMITS.statusPoll.max; i++) {
			expect(enforceRateLimit(key, RATE_LIMITS.statusPoll)).toBeNull();
		}

		const res = await postReconcile('valid');
		expect(res.status).toBe(429);
		expect(reconcileEnrollment).not.toHaveBeenCalled();
	});
});
