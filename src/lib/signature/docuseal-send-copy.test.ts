import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
	getEnv: vi.fn(() => ({
		DOCUSEAL_API_BASE: 'https://api.docuseal.eu',
	})),
}));

import { getEnv } from '../env';
import {
	DOCUSEAL_COPY_SEND_COOLDOWN_MS,
	isSubmitterCompleted,
	recentDocumentsCopySent,
	sendDocusealDocumentsCopy,
	submitterSlugFromEmbedSrc,
} from './docuseal-send-copy';

describe('submitterSlugFromEmbedSrc', () => {
	it('extrait le slug depuis embed_src', () => {
		expect(submitterSlugFromEmbedSrc('https://docuseal.eu/s/NLp5rn3W8tEtnj')).toBe('NLp5rn3W8tEtnj');
		expect(submitterSlugFromEmbedSrc('https://docuseal.eu/s/abc')).toBe('abc');
	});

	it('retourne null si URL invalide ou sans slug', () => {
		expect(submitterSlugFromEmbedSrc('not-a-url')).toBeNull();
		expect(submitterSlugFromEmbedSrc('https://docuseal.eu/d/template')).toBeNull();
	});
});

describe('isSubmitterCompleted', () => {
	it('accepte completed_at ou status completed', () => {
		expect(isSubmitterCompleted({ completed_at: '2024-01-01T00:00:00Z', status: 'awaiting' })).toBe(true);
		expect(isSubmitterCompleted({ completed_at: null, status: 'completed' })).toBe(true);
		expect(isSubmitterCompleted({ completed_at: null, status: 'awaiting' })).toBe(false);
	});
});

describe('recentDocumentsCopySent', () => {
	const now = Date.parse('2024-06-01T12:00:00Z');

	it('détecte un send_email récent', () => {
		expect(
			recentDocumentsCopySent(
				{
					submission_events: [
						{
							event_type: 'send_email',
							event_timestamp: new Date(now - 5 * 60 * 1000).toISOString(),
						},
					],
				},
				now,
			),
		).toBe(true);
	});

	it('ignore les send_email hors fenêtre de cooldown', () => {
		expect(
			recentDocumentsCopySent(
				{
					submission_events: [
						{
							event_type: 'send_email',
							event_timestamp: new Date(now - DOCUSEAL_COPY_SEND_COOLDOWN_MS - 1_000).toISOString(),
						},
					],
				},
				now,
			),
		).toBe(false);
	});

	it('ignore les autres types d’événements', () => {
		expect(
			recentDocumentsCopySent(
				{
					submission_events: [
						{
							event_type: 'view_form',
							event_timestamp: new Date(now - 1_000).toISOString(),
						},
					],
				},
				now,
			),
		).toBe(false);
	});
});

describe('sendDocusealDocumentsCopy', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('POST vers DocuSeal avec le slug encodé', async () => {
		vi.mocked(getEnv).mockReturnValueOnce({
			DOCUSEAL_API_BASE: 'https://api.docuseal.eu/v1',
		} as ReturnType<typeof getEnv>);
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await sendDocusealDocumentsCopy('abc/def');

		expect(fetchMock).toHaveBeenCalledWith(
			'https://docuseal.eu/send_submission_email.json?submitter_slug=abc%2Fdef',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('lève une erreur si DocuSeal répond en erreur', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })),
		);

		await expect(sendDocusealDocumentsCopy('slug')).rejects.toThrow('DocuSeal send copy 502');
	});
});
