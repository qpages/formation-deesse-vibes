import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { requireEnv } from './env';

function keyBytes() {
	return createHash('sha256').update(requireEnv('PAYLOAD_ENCRYPTION_KEY')).digest();
}

/** Chiffre un payload webhook pour stockage (rétention 30 j). */
export function encryptPayload(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function decryptPayload(ciphertext: string): string {
	const buf = Buffer.from(ciphertext, 'base64url');
	const iv = buf.subarray(0, 12);
	const tag = buf.subarray(12, 28);
	const data = buf.subarray(28);
	const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function generateToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}
