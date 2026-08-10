import { getEnv } from '../env';

export type OpsSeverity = 'info' | 'warn' | 'critical';

export type OpsKind =
	| 'checkout.created'
	| 'payment.first_confirmed'
	| 'payment.installment_paid'
	| 'collection.past_due'
	| 'collection.paid'
	| 'collection.refunded'
	| 'nda.sent'
	| 'nda.signed'
	| 'nda.monitor'
	| 'access.active'
	| 'access.suspended'
	| 'access.revoked'
	| 'job.final_failure'
	| 'admin.action'
	| 'ops.reconcile_issues';

export type OpsNotifyInput = {
	kind: OpsKind;
	severity: OpsSeverity;
	title: string;
	enrollmentId?: string;
	email?: string;
	detail?: string;
};

/** Facade: seul point d’I/O Slack (Incoming Webhook). Ne throw jamais. */
export async function notifyOps(input: OpsNotifyInput): Promise<void> {
	const lines = [
		`[${input.severity}] ${input.kind} — ${input.title}`,
		input.enrollmentId ? `Inscription: ${input.enrollmentId}` : null,
		input.email ? `E-mail: ${input.email}` : null,
		input.detail ? `Détail: ${input.detail}` : null,
	].filter(Boolean);

	await sendSlackAlert(lines.join('\n'));
}

async function sendSlackAlert(text: string): Promise<void> {
	const url = getEnv().SLACK_WEBHOOK_URL;
	if (!url) {
		console.warn('[slack] SLACK_WEBHOOK_URL manquant — alerte:', text);
		return;
	}

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text }),
		});

		if (!res.ok) {
			console.error('[slack] échec', res.status, await res.text());
		}
	} catch (error) {
		console.error('[slack] réseau', error);
	}
}

/** Wrapper Inngest onFailure → kind job.final_failure. */
export async function alertFinalFailure(context: {
	title: string;
	enrollmentId?: string;
	email?: string;
	error: string;
}) {
	await notifyOps({
		kind: 'job.final_failure',
		severity: 'critical',
		title: context.title,
		enrollmentId: context.enrollmentId,
		email: context.email,
		detail: context.error,
	});
}
