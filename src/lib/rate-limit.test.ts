import { afterEach, describe, expect, it } from 'vitest';
import {
	RATE_LIMITS,
	checkRateLimit,
	clientIp,
	enforceRateLimit,
	rateLimitKey,
	resetRateLimitStoreForTests,
} from './rate-limit';

afterEach(() => {
	resetRateLimitStoreForTests();
});

describe('clientIp', () => {
	it('prend le premier X-Forwarded-For', () => {
		const request = new Request('http://localhost', {
			headers: { 'x-forwarded-for': ' 1.1.1.1, 2.2.2.2' },
		});
		expect(clientIp(request, '9.9.9.9')).toBe('1.1.1.1');
	});

	it('retombe sur clientAddress', () => {
		expect(clientIp(new Request('http://localhost'), '9.9.9.9')).toBe('9.9.9.9');
	});
});

describe('checkRateLimit', () => {
	const policy = { name: 't', max: 2, windowMs: 1000 };

	it('autorise jusqu’à max, puis 429', () => {
		expect(checkRateLimit('k', policy, 1000)).toEqual({ ok: true });
		expect(checkRateLimit('k', policy, 1100)).toEqual({ ok: true });
		expect(checkRateLimit('k', policy, 1200)).toEqual({ ok: false, retryAfterSec: 1 });
	});

	it('glisse la fenêtre', () => {
		expect(checkRateLimit('k', policy, 1000).ok).toBe(true);
		expect(checkRateLimit('k', policy, 1100).ok).toBe(true);
		expect(checkRateLimit('k', policy, 2001).ok).toBe(true);
	});
});

describe('enforceRateLimit', () => {
	it('renvoie une Response 429 + Retry-After', () => {
		const policy = RATE_LIMITS.adminLogin;
		const key = rateLimitKey(policy, ['1.1.1.1']);
		for (let i = 0; i < policy.max; i++) {
			expect(enforceRateLimit(key, policy)).toBeNull();
		}
		const blocked = enforceRateLimit(key, policy);
		expect(blocked?.status).toBe(429);
		expect(blocked?.headers.get('Retry-After')).toMatch(/^\d+$/);
	});
});
