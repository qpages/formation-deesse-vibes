import { e2eMockProviders } from '../e2e-providers';
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
	| 'job.first_failure'
	| 'job.recovered'
	| 'job.final_failure'
	| 'admin.action'
	| 'admin.login'
	| 'auth.magic_link_requested'
	| 'auth.magic_link_consumed'
	| 'nda.resend_requested'
	| 'nda.copy_sent'
	| 'ops.api_error'
	| 'ops.reconcile_issues';

export type OpsNotifyInput = {
	kind: OpsKind;
	severity: OpsSeverity;
	title: string;
	enrollmentId?: string;
	email?: string;
	detail?: string;
};

type JobAlertContext = {
	title: string;
	enrollmentId?: string;
	email?: string;
	error?: string;
	detail?: string;
};

/** Inclut `error.cause` (ex. ENOTFOUND derrière un `fetch failed`). */
export function formatErrorDetail(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause =
		error.cause instanceof Error
			? error.cause.message
			: error.cause != null
				? String(error.cause)
				: null;
	return cause ? `${error.message} — ${cause}` : error.message;
}

/** Clics user répétés : 1 alerte Slack par fenêtre (best-effort multi-instance). */
export const OPS_ALERT_DEDUPE_MS: Partial<Record<OpsKind, number>> = {
	'admin.login': 2 * 60 * 1000,
	'auth.magic_link_requested': 60 * 1000,
};

const lastOpsAlertAt = new Map<string, number>();

export function opsAlertDedupeKey(
	input: Pick<OpsNotifyInput, 'kind' | 'email' | 'enrollmentId'>,
): string {
	return [input.kind, input.email ?? '', input.enrollmentId ?? ''].join('|');
}

export function shouldSendOpsAlert(input: OpsNotifyInput, now = Date.now()): boolean {
	const windowMs = OPS_ALERT_DEDUPE_MS[input.kind];
	if (!windowMs) return true;
	const key = opsAlertDedupeKey(input);
	const prev = lastOpsAlertAt.get(key);
	if (prev != null && now - prev < windowMs) return false;
	lastOpsAlertAt.set(key, now);
	return true;
}

export function resetOpsAlertDedupeForTests() {
	lastOpsAlertAt.clear();
}

/** Facade: seul point d’I/O Slack (Incoming Webhook). Ne throw jamais. */
export async function notifyOps(input: OpsNotifyInput): Promise<void> {
	if (e2eMockProviders()) return;
	if (!shouldSendOpsAlert(input)) return;

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

/** Premier échec Inngest (attempt 0) — retries à suivre. */
export async function alertFirstFailure(context: JobAlertContext & { error: string }) {
	await notifyOps({
		kind: 'job.first_failure',
		severity: 'warn',
		title: context.title,
		enrollmentId: context.enrollmentId,
		email: context.email,
		detail: context.error,
	});
}

/** Succès après au moins un retry. */
export async function alertJobRecovered(context: JobAlertContext) {
	await notifyOps({
		kind: 'job.recovered',
		severity: 'info',
		title: context.title,
		enrollmentId: context.enrollmentId,
		email: context.email,
		detail: context.detail,
	});
}

/** Wrapper Inngest onFailure → kind job.final_failure. */
export async function alertFinalFailure(context: JobAlertContext & { error: string }) {
	await notifyOps({
		kind: 'job.final_failure',
		severity: 'critical',
		title: context.title,
		enrollmentId: context.enrollmentId,
		email: context.email,
		detail: context.error,
	});
}

/**
 * Cycle Slack pour un job Inngest :
 * attempt 0 fail → first_failure ; retries silencieux ; succès après retry → recovered.
 * (Le final_failure reste dans `onFailure`.)
 */
export async function withJobLifecycleAlerts<T>(opts: {
	attempt: number;
	jobLabel: string;
	enrollmentId?: string;
	email?: string;
	run: () => Promise<T>;
}): Promise<T> {
	try {
		const result = await opts.run();
		if (opts.attempt > 0) {
			await alertJobRecovered({
				title: `${opts.jobLabel} — débloqué après retry`,
				enrollmentId: opts.enrollmentId,
				email: opts.email,
				detail: `attempt=${opts.attempt}`,
			});
		}
		return result;
	} catch (error) {
		if (opts.attempt === 0) {
			await alertFirstFailure({
				title: `${opts.jobLabel} — échec, retry en cours`,
				enrollmentId: opts.enrollmentId,
				email: opts.email,
				error: formatErrorDetail(error),
			});
		}
		throw error;
	}
}
