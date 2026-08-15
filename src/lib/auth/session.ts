import { SignJWT, jwtVerify } from 'jose';
import { getAdminAllowlist, requireEnv } from '../env';

const TRACKING_COOKIE = 'dv_enrollment';
const ADMIN_COOKIE = 'dv_admin';

function secretKey(kind: 'session' | 'magic') {
	const value = kind === 'session' ? requireEnv('SESSION_SECRET') : requireEnv('MAGIC_LINK_SECRET');
	return new TextEncoder().encode(value);
}

export async function createEnrollmentSessionToken(enrollmentId: string) {
	return new SignJWT({ enrollmentId, typ: 'enrollment' })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('30d')
		.sign(secretKey('session'));
}

export async function verifyEnrollmentSessionToken(token: string) {
	try {
		const { payload } = await jwtVerify(token, secretKey('session'));
		if (payload.typ !== 'enrollment' || typeof payload.enrollmentId !== 'string') {
			return null;
		}
		return payload.enrollmentId;
	} catch {
		return null;
	}
}

export async function createAdminSessionToken(email: string) {
	return new SignJWT({ email, typ: 'admin' })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('12h')
		.sign(secretKey('session'));
}

export async function verifyAdminSessionToken(token: string) {
	try {
		const { payload } = await jwtVerify(token, secretKey('session'));
		if (payload.typ !== 'admin' || typeof payload.email !== 'string') return null;
		const email = payload.email.toLowerCase();
		if (!getAdminAllowlist().includes(email)) return null;
		return email;
	} catch {
		return null;
	}
}

function secureFlag() {
	const site = import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? '';
	return site.startsWith('https') ? '; Secure' : '';
}

export function enrollmentCookieOptions(token: string) {
	return `${TRACKING_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secureFlag()}`;
}

export function clearEnrollmentCookie() {
	return `${TRACKING_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

export function adminCookieOptions(token: string) {
	return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}${secureFlag()}`;
}

export function clearAdminCookie() {
	return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

export function parseCookie(header: string | null, name: string): string | null {
	if (!header) return null;
	const parts = header.split(';');
	for (const part of parts) {
		const [k, ...rest] = part.trim().split('=');
		if (k === name) return rest.join('=') || null;
	}
	return null;
}

export { TRACKING_COOKIE, ADMIN_COOKIE };
