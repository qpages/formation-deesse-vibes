import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestNdaSignatureRefresh } = vi.hoisted(() => ({
	requestNdaSignatureRefresh: vi.fn(),
}));

vi.mock('./refresh-nda-signature', () => ({
	requestNdaSignatureRefresh,
}));

import {
	__resetEnrollmentStatusClientForTests,
	cleanEnrollmentQueryParams,
	reloadEnrollmentStatus,
	startEnrollmentPolling,
} from './enrollment-status-client';

function createPanel(overrides: Record<string, string> = {}): HTMLElement {
	const dataset: DOMStringMap = {
		poll: 'true',
		signSurface: 'true',
		signSurfaceKind: 'embed',
		pollInterval: '100',
		pollMax: '60000',
		fingerprint: 'paid|sent|pending',
		collectionStatus: 'paid',
		contractStatus: 'sent',
		accessStatus: 'pending',
		...overrides,
	} as DOMStringMap;
	return {
		id: 'status-panel',
		dataset,
		querySelector: () => null,
	} as unknown as HTMLElement;
}

function stubPollingDocument(panel?: HTMLElement) {
	vi.stubGlobal('document', {
		visibilityState: 'visible',
		addEventListener: vi.fn(),
		getElementById: (id: string) => (id === 'status-panel' ? (panel ?? null) : null),
	});
}

describe('reloadEnrollmentStatus', () => {
	afterEach(() => {
		__resetEnrollmentStatusClientForTests();
		vi.unstubAllGlobals();
	});

	it('ne déclenche qu’un seul reload en rafale', () => {
		const reload = vi.fn();
		vi.stubGlobal('window', {
			location: { hash: '', reload },
		});

		reloadEnrollmentStatus();
		reloadEnrollmentStatus();

		expect(reload).toHaveBeenCalledTimes(1);
		expect(window.location.hash).toBe('acces');
	});
});

describe('cleanEnrollmentQueryParams', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('retire checkout et session_id après affichage', () => {
		const replaceState = vi.fn();
		vi.stubGlobal('window', {
			location: {
				href: 'https://example.test/?checkout=success&session_id=cs_test_123#acces',
				pathname: '/',
				search: '?checkout=success&session_id=cs_test_123',
				hash: '#acces',
			},
			history: { replaceState },
		});

		cleanEnrollmentQueryParams();

		expect(replaceState).toHaveBeenCalledWith({}, '', '/#acces');
	});
});

describe('startEnrollmentPolling', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		requestNdaSignatureRefresh.mockReset();
	});

	afterEach(() => {
		__resetEnrollmentStatusClientForTests();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('appelle nda-sync pendant le polling quand la surface de signature est active', async () => {
		requestNdaSignatureRefresh.mockResolvedValue({ signed: false, message: 'En attente.' });
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				fingerprint: 'paid|sent|pending',
				poll: true,
				hasSignSurface: true,
				collectionStatus: 'paid',
				contractStatus: 'sent',
				accessStatus: 'pending',
				signSurfaceKind: 'embed',
				hasCheckoutSession: false,
				view: {
					showSignSurfaceReady: true,
					showPaymentPending: false,
					showSignWaiting: false,
					showSignUnavailable: false,
					message: null,
					action: { kind: 'none' },
					closed: false,
					showNdaConfirm: false,
				},
			}),
		});
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal('window', {
			location: { hash: '', reload: vi.fn() },
		});
		stubPollingDocument();

		const panel = createPanel();
		startEnrollmentPolling(panel);
		await vi.advanceTimersByTimeAsync(100);

		expect(requestNdaSignatureRefresh).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith('/api/enrollment/status', expect.any(Object));
	});

	it('reprend le polling après une erreur transitoire de nda-sync', async () => {
		requestNdaSignatureRefresh
			.mockRejectedValueOnce(new Error('Network unavailable'))
			.mockResolvedValue({ signed: false, message: 'En attente.' });
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				fingerprint: 'paid|sent|pending',
				poll: true,
				hasSignSurface: true,
				collectionStatus: 'paid',
				contractStatus: 'sent',
				accessStatus: 'pending',
				signSurfaceKind: 'embed',
				hasCheckoutSession: false,
				view: {
					showSignSurfaceReady: true,
					showPaymentPending: false,
					showSignWaiting: false,
					showSignUnavailable: false,
					message: null,
					action: { kind: 'none' },
					closed: false,
					showNdaConfirm: false,
				},
			}),
		});
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal('window', {
			location: { hash: '', reload: vi.fn() },
		});
		const panel = createPanel();
		stubPollingDocument(panel);

		startEnrollmentPolling(panel);
		await vi.advanceTimersByTimeAsync(200);

		expect(requestNdaSignatureRefresh).toHaveBeenCalledTimes(2);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('déclenche un reload quand nda-sync confirme la signature', async () => {
		requestNdaSignatureRefresh.mockResolvedValue({ signed: true });
		const reload = vi.fn();
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				fingerprint: 'paid|signed|pending',
				poll: false,
				hasSignSurface: false,
				collectionStatus: 'paid',
				contractStatus: 'signed',
				accessStatus: 'pending',
				signSurfaceKind: null,
				hasCheckoutSession: false,
				view: {
					showSignSurfaceReady: false,
					showPaymentPending: false,
					showSignWaiting: false,
					showSignUnavailable: false,
					message: null,
					action: { kind: 'none' },
					closed: false,
					showNdaConfirm: false,
				},
			}),
		});
		vi.stubGlobal('fetch', fetch);

		const panel = createPanel({
			collectionStatus: 'paid',
			contractStatus: 'sent',
			accessStatus: 'pending',
			signSurfaceKind: 'embed',
		});

		vi.stubGlobal('window', {
			location: { hash: '', reload },
		});
		stubPollingDocument(panel);

		startEnrollmentPolling(panel);
		await vi.advanceTimersByTimeAsync(100);

		expect(requestNdaSignatureRefresh).toHaveBeenCalledTimes(1);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('recharge quand la surface de signature apparaît côté API', async () => {
		const reload = vi.fn();
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				fingerprint: 'current|sent|not_eligible',
				poll: true,
				hasSignSurface: true,
				collectionStatus: 'current',
				contractStatus: 'sent',
				accessStatus: 'not_eligible',
				signSurfaceKind: 'embed',
				hasCheckoutSession: true,
				view: {
					showSignSurfaceReady: true,
					showPaymentPending: false,
					showSignWaiting: false,
					showSignUnavailable: false,
					message: null,
					action: { kind: 'none' },
					closed: false,
					showNdaConfirm: false,
				},
			}),
		});
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal('window', {
			location: { hash: '', reload },
		});
		stubPollingDocument();

		const panel = createPanel({
			signSurface: 'false',
			signSurfaceKind: '',
			contractStatus: 'pending',
			fingerprint: 'current|pending|not_eligible',
		});
		startEnrollmentPolling(panel);
		await vi.advanceTimersByTimeAsync(100);

		expect(reload).toHaveBeenCalledTimes(1);
		expect(window.location.hash).toBe('acces');
	});

	it('déclenche un reload quand la surface de signature apparaît', async () => {
		const reload = vi.fn();
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				fingerprint: 'current|sent|not_eligible',
				poll: true,
				hasSignSurface: true,
				collectionStatus: 'current',
				contractStatus: 'sent',
				accessStatus: 'not_eligible',
				signSurfaceKind: 'embed',
				hasCheckoutSession: true,
				view: {
					showSignSurfaceReady: true,
					showPaymentPending: false,
					showSignWaiting: false,
					showSignUnavailable: false,
					message: null,
					action: { kind: 'refresh', label: 'Actualiser' },
					closed: false,
					showNdaConfirm: false,
				},
			}),
		});
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal('window', {
			location: { hash: '', reload },
		});
		stubPollingDocument();

		const panel = createPanel({
			fingerprint: 'current|pending|not_eligible',
			collectionStatus: 'current',
			contractStatus: 'pending',
			signSurface: 'false',
			signSurfaceKind: '',
		});
		startEnrollmentPolling(panel);
		await vi.advanceTimersByTimeAsync(100);

		expect(fetch).toHaveBeenCalledWith(
			'/api/enrollment/reconcile',
			expect.objectContaining({ method: 'POST' }),
		);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(window.location.hash).toBe('acces');
	});

	it('reconcilie côté serveur et recharge quand le paiement se confirme (symptôme A)', async () => {
		const reload = vi.fn();
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				fingerprint: 'paid|sent|not_eligible',
				poll: true,
				hasSignSurface: true,
				collectionStatus: 'paid',
				contractStatus: 'sent',
				accessStatus: 'not_eligible',
				signSurfaceKind: 'redirect',
				hasCheckoutSession: true,
				view: {
					showSignSurfaceReady: true,
					showPaymentPending: false,
					showSignWaiting: false,
					showSignUnavailable: false,
					message: null,
					action: { kind: 'none' },
					closed: false,
					showNdaConfirm: false,
				},
			}),
		});
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal('window', {
			location: { hash: '', reload },
		});
		stubPollingDocument();

		// Écran « paiement en attente de confirmation » : pas de surface, paiement pending.
		const panel = createPanel({
			signSurface: 'false',
			signSurfaceKind: '',
			collectionStatus: 'pending',
			contractStatus: 'pending',
			accessStatus: 'not_eligible',
			fingerprint: 'pending|pending|not_eligible',
		});
		startEnrollmentPolling(panel);
		await vi.advanceTimersByTimeAsync(100);

		// Le polling doit piloter la réconciliation serveur, pas seulement lire le statut.
		expect(fetch).toHaveBeenCalledWith(
			'/api/enrollment/reconcile',
			expect.objectContaining({ method: 'POST' }),
		);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(window.location.hash).toBe('acces');
	});

	it('n’appelle pas nda-sync sans surface de signature active', async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				fingerprint: 'paid|sent|pending',
				poll: true,
				hasSignSurface: false,
				collectionStatus: 'paid',
				contractStatus: 'sent',
				accessStatus: 'pending',
				signSurfaceKind: null,
				hasCheckoutSession: false,
				view: {
					showSignSurfaceReady: false,
					showPaymentPending: false,
					showSignWaiting: false,
					showSignUnavailable: false,
					message: null,
					action: { kind: 'none' },
					closed: false,
					showNdaConfirm: false,
				},
			}),
		});
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal('window', {
			location: { hash: '', reload: vi.fn() },
		});
		stubPollingDocument();

		const panel = createPanel({ signSurface: 'false', signSurfaceKind: '' });
		startEnrollmentPolling(panel);
		await vi.advanceTimersByTimeAsync(100);

		expect(requestNdaSignatureRefresh).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledWith(
			'/api/enrollment/reconcile',
			expect.objectContaining({ method: 'POST' }),
		);
	});
});
