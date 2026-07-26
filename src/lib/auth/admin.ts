import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '../env';

function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

export async function authenticateAdmin(email: string, password: string) {
	const { ADMIN_EMAIL, ADMIN_PASSWORD } = getEnv();
	if (!ADMIN_PASSWORD) return null;

	const expectedEmail = ADMIN_EMAIL.trim().toLowerCase();
	const normalized = email.trim().toLowerCase();

	const emailOk = safeEqual(normalized, expectedEmail);
	const passwordOk = safeEqual(password, ADMIN_PASSWORD);
	if (!emailOk || !passwordOk) return null;

	return { email: expectedEmail };
}
