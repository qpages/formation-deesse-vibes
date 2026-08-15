import { json } from './http';

// In-memory sliding window: multi-instance (Vercel) is best-effort until a shared store exists.

export type RateLimitPolicy = {
	name: string;
	max: number;
	windowMs: number;
};

export const RATE_LIMITS = {
	adminLogin: { name: 'admin-login', max: 5, windowMs: 15 * 60 * 1000 },
	magicLink: { name: 'magic-link', max: 5, windowMs: 15 * 60 * 1000 },
	checkout: { name: 'checkout', max: 8, windowMs: 10 * 60 * 1000 },
} as const satisfies Record<string, RateLimitPolicy>;

const hits = new Map<string, number[]>();

export function clientIp(request: Request, clientAddress?: string): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) {
		const first = forwarded.split(',')[0]?.trim();
		if (first) return first;
	}
	return clientAddress?.trim() || 'unknown';
}

export function rateLimitKey(
	policy: RateLimitPolicy,
	parts: Array<string | null | undefined>,
): string {
	return [policy.name, ...parts.map((part) => (part ?? '').trim().toLowerCase() || '-')].join(':');
}

export function checkRateLimit(
	key: string,
	policy: RateLimitPolicy,
	now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
	const windowStart = now - policy.windowMs;
	const recent = (hits.get(key) ?? []).filter((ts) => ts > windowStart);
	if (recent.length >= policy.max) {
		const retryAfterSec = Math.max(1, Math.ceil((recent[0]! + policy.windowMs - now) / 1000));
		hits.set(key, recent);
		return { ok: false, retryAfterSec };
	}
	recent.push(now);
	hits.set(key, recent);
	return { ok: true };
}

export function rateLimitedResponse(retryAfterSec: number): Response {
	return json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' }, 429, {
		'Retry-After': String(retryAfterSec),
	});
}

export function enforceRateLimit(
	key: string,
	policy: RateLimitPolicy,
	now = Date.now(),
): Response | null {
	const result = checkRateLimit(key, policy, now);
	if (result.ok) return null;
	return rateLimitedResponse(result.retryAfterSec);
}

export function resetRateLimitStoreForTests() {
	hits.clear();
}
