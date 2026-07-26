import { requireEnv } from '../env';

/** Webhook Make → invitation Teachizy (jamais depuis le navigateur). */
export async function triggerTeachizyInvite(input: {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
	yousignRequestId: string;
}) {
	const url = requireEnv('MAKE_WEBHOOK_URL');
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			source: 'formation-deesse-vibes',
			event: 'nda_signed',
			enrollmentId: input.enrollmentId,
			email: input.email,
			firstName: input.firstName,
			lastName: input.lastName,
			yousignRequestId: input.yousignRequestId,
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Make webhook ${res.status}: ${body}`);
	}
}
