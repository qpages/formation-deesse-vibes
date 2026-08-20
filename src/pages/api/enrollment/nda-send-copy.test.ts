import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	parseCookie,
	verifyEnrollmentSessionToken,
	findEnrollmentById,
	sendDocusealDocumentsCopy,
	notifyOps,
	docusealGetSubmitter,
} = vi.hoisted(() => ({
	parseCookie: vi.fn(),
	verifyEnrollmentSessionToken: vi.fn(),
	findEnrollmentById: vi.fn(),
	sendDocusealDocumentsCopy: vi.fn(),
	notifyOps: vi.fn(),
	docusealGetSubmitter: vi.fn(),
}));

vi.mock('../../../lib/auth/session', () => ({
	parseCookie,
	verifyEnrollmentSessionToken,
	TRACKING_COOKIE: 'dv_enrollment',
}));
vi.mock('../../../lib/enrollment/queries', () => ({ findEnrollmentById }));
vi.mock('../../../lib/signature/docuseal-send-copy', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../lib/signature/docuseal-send-copy')>();
	return {
		...actual,
		sendDocusealDocumentsCopy,
	};
});
vi.mock('../../../lib/signature/adapters/docuseal', () => ({
	docusealAdapter: { getSubmitter: docusealGetSubmitter },
}));
vi.mock('../../../lib/services/slack', () => ({ notifyOps, formatErrorDetail: (e: unknown) => String(e) }));

import { POST } from './nda-send-copy';
import { RATE_LIMITS, enforceRateLimit, rateLimitKey, resetRateLimitStoreForTests } from '../../../lib/rate-limit';

function signedEmbedEnrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		contractStatus: 'signed',
		user: { email: 'learner@example.test' },
		ndaRequest: {
			provider: 'docuseal',
			signKind: 'embed',
			externalRequestId: 'req_1',
			externalSignerId: 'sub_1',
			metadata: { embed_src: 'https://docuseal.eu/s/embed-slug' },
		},
		...overrides,
	};
}

function postNdaSendCopy(cookie?: string) {
	return POST({
		request: new Request('http://localhost/api/enrollment/nda-send-copy', {
			method: 'POST',
			headers: cookie ? { cookie: `dv_enrollment=${cookie}` } : {},
		}),
		clientAddress: '127.0.0.1',
	} as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	vi.clearAllMocks();
	resetRateLimitStoreForTests();
	sendDocusealDocumentsCopy.mockResolvedValue(undefined);
	notifyOps.mockResolvedValue(undefined);
});

afterEach(() => {
	resetRateLimitStoreForTests();
});

describe('POST /api/enrollment/nda-send-copy', () => {
	it('sans cookie → 401', async () => {
		parseCookie.mockReturnValue(null);

		const res = await postNdaSendCopy();
		expect(res.status).toBe(401);
		expect(sendDocusealDocumentsCopy).not.toHaveBeenCalled();
	});

	it('session invalide → 401', async () => {
		parseCookie.mockReturnValue('bad');
		verifyEnrollmentSessionToken.mockResolvedValue(null);

		const res = await postNdaSendCopy('bad');
		expect(res.status).toBe(401);
	});

	it('yousign ou redirect → 403', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		findEnrollmentById.mockResolvedValue(
			signedEmbedEnrollment({
				ndaRequest: {
					provider: 'yousign',
					signKind: 'redirect',
					externalRequestId: 'req_1',
					externalSignerId: 'sub_1',
					metadata: null,
				},
			}),
		);

		const res = await postNdaSendCopy('valid');
		expect(res.status).toBe(403);
		expect(sendDocusealDocumentsCopy).not.toHaveBeenCalled();
	});

	it('docuseal redirect (non embed) → 403', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		findEnrollmentById.mockResolvedValue(
			signedEmbedEnrollment({
				ndaRequest: {
					provider: 'docuseal',
					signKind: 'redirect',
					externalRequestId: 'req_1',
					externalSignerId: 'sub_1',
					metadata: null,
				},
			}),
		);

		const res = await postNdaSendCopy('valid');
		expect(res.status).toBe(403);
	});

	it('contrat pas signé → 409', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		findEnrollmentById.mockResolvedValue(
			signedEmbedEnrollment({ contractStatus: 'sent' }),
		);

		const res = await postNdaSendCopy('valid');
		expect(res.status).toBe(409);
	});

	it('succès docuseal embed → copie envoyée', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		findEnrollmentById.mockResolvedValue(signedEmbedEnrollment());
		docusealGetSubmitter.mockResolvedValue({
			slug: 'embed-slug',
			status: 'completed',
			completed_at: new Date().toISOString(),
		});

		const res = await postNdaSendCopy('valid');
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true });
		expect(sendDocusealDocumentsCopy).toHaveBeenCalledWith('embed-slug');
		expect(notifyOps).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'nda.copy_sent', enrollmentId: 'enr_1' }),
		);
	});

	it('slug via getSubmitter si embed_src absent', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		findEnrollmentById.mockResolvedValue(
			signedEmbedEnrollment({
				ndaRequest: {
					provider: 'docuseal',
					signKind: 'embed',
					externalRequestId: 'req_1',
					externalSignerId: 'sub_1',
					metadata: null,
				},
			}),
		);
		docusealGetSubmitter.mockResolvedValue({
			slug: 'from-api-slug',
			status: 'completed',
			completed_at: new Date().toISOString(),
		});

		const res = await postNdaSendCopy('valid');
		expect(res.status).toBe(200);
		expect(sendDocusealDocumentsCopy).toHaveBeenCalledWith('from-api-slug');
	});

	it('rate limit → 429', async () => {
		parseCookie.mockReturnValue('valid');
		verifyEnrollmentSessionToken.mockResolvedValue('enr_1');
		const key = rateLimitKey(RATE_LIMITS.ndaSendCopy, ['127.0.0.1', 'enr_1']);
		for (let i = 0; i < RATE_LIMITS.ndaSendCopy.max; i++) {
			expect(enforceRateLimit(key, RATE_LIMITS.ndaSendCopy)).toBeNull();
		}

		const res = await postNdaSendCopy('valid');
		expect(res.status).toBe(429);
		expect(sendDocusealDocumentsCopy).not.toHaveBeenCalled();
	});
});
