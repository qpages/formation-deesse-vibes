import type { DocusealSubmitter } from './adapters/docuseal';
import { e2eMockProviders } from '../e2e-providers';
import { getEnv } from '../env';

/** DocuSeal skips duplicate copy sends for this window (see SendSubmissionEmailController). */
export const DOCUSEAL_COPY_SEND_COOLDOWN_MS = 30 * 60 * 1000;

export function submitterSlugFromEmbedSrc(src: string): string | null {
	try {
		const match = new URL(src).pathname.match(/\/s\/([^/]+)/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

function docusealSigningHost(): string {
	const apiBase = getEnv().DOCUSEAL_API_BASE;
	if (apiBase.includes('.com')) return 'https://docuseal.com';
	return 'https://docuseal.eu';
}

const SEND_COPY_TIMEOUT_MS = 20_000;

export function isSubmitterCompleted(submitter: Pick<DocusealSubmitter, 'completed_at' | 'status'>): boolean {
	return Boolean(submitter.completed_at) || submitter.status === 'completed';
}

/** True when DocuSeal would silently skip another copy send (still returns HTTP 200). */
export function recentDocumentsCopySent(
	submitter: Pick<DocusealSubmitter, 'submission_events'>,
	now = Date.now(),
): boolean {
	const cutoff = now - DOCUSEAL_COPY_SEND_COOLDOWN_MS;
	return (submitter.submission_events ?? []).some((event) => {
		if (event.event_type !== 'send_email') return false;
		const ts = new Date(event.event_timestamp).getTime();
		return !Number.isNaN(ts) && ts >= cutoff;
	});
}

/**
 * Same public endpoint as the DocuSeal embed « Send copy to Email » button.
 * DocuSeal always responds 200 even when no e-mail is queued (cooldown, incomplete submitter).
 */
export async function sendDocusealDocumentsCopy(submitterSlug: string): Promise<void> {
	if (e2eMockProviders()) return;

	const host = docusealSigningHost();
	const url = `${host}/send_submission_email.json?submitter_slug=${encodeURIComponent(submitterSlug)}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(SEND_COPY_TIMEOUT_MS),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`DocuSeal send copy ${res.status}: ${text}`);
	}
}
