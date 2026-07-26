import { getEnv } from '../env';

export async function sendSlackAlert(text: string, blocks?: unknown[]) {
	const url = getEnv().SLACK_WEBHOOK_URL;
	if (!url) {
		console.warn('[slack] SLACK_WEBHOOK_URL manquant — alerte:', text);
		return;
	}

	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, blocks }),
	});

	if (!res.ok) {
		console.error('[slack] échec', res.status, await res.text());
	}
}

export async function alertFinalFailure(context: {
	title: string;
	enrollmentId?: string;
	email?: string;
	error: string;
}) {
	await sendSlackAlert(
		`🚨 ${context.title}\nInscription: ${context.enrollmentId ?? '—'}\nE-mail: ${context.email ?? '—'}\nErreur: ${context.error}`,
	);
}
