import type { EnrollmentStatusPayload, StatusPanelViewPayload } from '../enrollment/status-payload';
import {
	snapshotFromPanel,
	snapshotFromPayload,
	statusUpdateRequiresReload,
} from '../status/snapshot';
import {
	ENROLLMENT_POLL_INTERVAL_MS,
	ENROLLMENT_POLL_MAX_MS,
	ENROLLMENT_RECONCILE_INTERVAL_MS,
	type PrimaryAction,
} from '../status';
import { requestNdaSignatureRefresh } from './refresh-nda-signature';

const RELOAD_DEDUP_MS = 500;

/**
 * Cadence de la réconciliation serveur pilotée par le polling. Plus lâche que le
 * tick (2s) pour ne pas marteler Stripe/DocuSeal, mais assez rapide pour que le
 * paiement et la provision NDA avancent sans rechargement manuel.
 */
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pollStopped = true;
let pollInFlight = false;
let pollStartedAt = 0;
let lastReconcileAt = 0;
let pollPanel: HTMLElement | null = null;
let reloadPending = false;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;

const BUTTON_BASE =
	'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush disabled:pointer-events-none disabled:opacity-50';
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-ink text-mist hover:bg-ink-soft shadow-[0_12px_30px_rgb(26_20_16/0.18)] h-12 px-6 text-sm tracking-wide`;

let visibilityListenerBound = false;

function setHidden(element: Element | null, hidden: boolean) {
	if (!element) return;
	element.classList.toggle('hidden', hidden);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function renderMessageBlock(view: StatusPanelViewPayload): string {
	if (!view.message) return '';

	if (!view.showSignSurfaceReady && view.action.kind === 'open_platform') {
		const [lead, detail] = view.message;
		return `<div class="max-w-prose space-y-1.5">
			<p class="text-ink-soft text-lg leading-snug font-normal sm:text-xl">${escapeHtml(lead ?? '')}</p>
			${detail ? `<p class="text-ink-soft text-sm leading-relaxed sm:text-[0.9375rem]">${escapeHtml(detail)}</p>` : ''}
		</div>`;
	}

	return `<div class="max-w-prose space-y-1.5">${view.message
		.map((line) => `<p class="text-ink-soft text-sm">${escapeHtml(line)}</p>`)
		.join('')}</div>`;
}

function renderActionBlock(action: PrimaryAction, showSignSurface: boolean): string {
	if (showSignSurface) return '';

	if (action.kind === 'open_platform') {
		return `<a href="${escapeHtml(action.href)}" class="${BUTTON_PRIMARY} w-full whitespace-nowrap sm:w-auto" target="_blank" rel="noopener noreferrer">${escapeHtml(action.label)}</a>`;
	}

	if (action.kind === 'refresh') {
		return `<button type="button" id="status-refresh" class="${BUTTON_PRIMARY} w-full whitespace-nowrap sm:w-auto">${escapeHtml(action.label)}</button>`;
	}

	return '';
}

export function stopEnrollmentPolling() {
	pollStopped = true;
	pollPanel = null;
	if (pollTimer !== undefined) {
		clearTimeout(pollTimer);
		pollTimer = undefined;
	}
}

function markReloadPending(): boolean {
	if (reloadPending) return false;
	reloadPending = true;
	if (reloadTimer !== undefined) clearTimeout(reloadTimer);
	reloadTimer = setTimeout(() => {
		reloadPending = false;
		reloadTimer = undefined;
	}, RELOAD_DEDUP_MS);
	return true;
}

export function reloadEnrollmentStatus() {
	if (!markReloadPending()) return;
	stopEnrollmentPolling();
	window.location.hash = 'acces';
	window.location.reload();
}

export async function fetchEnrollmentStatus(): Promise<EnrollmentStatusPayload | null> {
	try {
		const res = await fetch('/api/enrollment/status', {
			headers: { Accept: 'application/json' },
			credentials: 'same-origin',
		});
		if (!res.ok) return null;
		return (await res.json()) as EnrollmentStatusPayload;
	} catch {
		return null;
	}
}

/**
 * Rejoue la réconciliation serveur (paiement + provision + signature + accès),
 * comme le fait un rechargement SSR, puis renvoie le statut à jour. C'est ce qui
 * fait avancer l'écran « paiement en attente de confirmation » sans refresh même
 * si le webhook Stripe n'arrive pas.
 */
export async function reconcileEnrollmentStatus(): Promise<EnrollmentStatusPayload | null> {
	try {
		const res = await fetch('/api/enrollment/reconcile', {
			method: 'POST',
			headers: { Accept: 'application/json' },
			credentials: 'same-origin',
		});
		if (!res.ok) return null;
		return (await res.json()) as EnrollmentStatusPayload;
	} catch {
		return null;
	}
}

function bindRefreshButton(panel: HTMLElement) {
	panel.querySelector('#status-refresh')?.addEventListener('click', (event) => {
		event.preventDefault();
		reloadEnrollmentStatus();
	});
}

export function applyStatusPanelPatch(panel: HTMLElement, payload: EnrollmentStatusPayload): void {
	const { view } = payload;

	setHidden(panel.querySelector('#status-sign-ready'), !view.showSignSurfaceReady);
	setHidden(panel.querySelector('#status-sign-surface'), !payload.hasSignSurface);
	setHidden(panel.querySelector('#status-payment-pending'), !view.showPaymentPending);
	setHidden(panel.querySelector('#status-sign-waiting'), !view.showSignWaiting);
	setHidden(panel.querySelector('#status-sign-unavailable'), !view.showSignUnavailable);

	const messageBlock = panel.querySelector('#status-message-block');
	if (messageBlock) {
		messageBlock.innerHTML = renderMessageBlock(view);
	}

	const actionBlock = panel.querySelector('#status-action-block');
	if (actionBlock) {
		actionBlock.innerHTML = renderActionBlock(view.action, view.showSignSurfaceReady);
		bindRefreshButton(panel);
	}

	setHidden(panel.querySelector('#status-closed-alert'), !view.closed);
	setHidden(panel.querySelector('#status-nda-confirm'), !view.showNdaConfirm);

	panel.dataset.fingerprint = payload.fingerprint;
	panel.dataset.poll = payload.poll ? 'true' : 'false';
	panel.dataset.collectionStatus = payload.collectionStatus;
	panel.dataset.contractStatus = payload.contractStatus;
	panel.dataset.accessStatus = payload.accessStatus;
	panel.dataset.signSurface = payload.hasSignSurface ? 'true' : 'false';
	panel.dataset.signSurfaceKind = payload.signSurfaceKind ?? '';
}

async function processStatusPayload(
	panel: HTMLElement,
	payload: EnrollmentStatusPayload,
): Promise<'patched' | 'reload' | 'unchanged'> {
	const before = snapshotFromPanel(panel);
	const after = snapshotFromPayload(payload);

	if (statusUpdateRequiresReload(before, after)) {
		reloadEnrollmentStatus();
		return 'reload';
	}

	if (payload.fingerprint === panel.dataset.fingerprint) {
		if (!payload.poll) stopEnrollmentPolling();
		return 'unchanged';
	}

	applyStatusPanelPatch(panel, payload);
	if (!payload.poll) stopEnrollmentPolling();
	return 'patched';
}

export async function refreshEnrollmentAfterNdaSigned(): Promise<void> {
	stopEnrollmentPolling();
	const panel = document.getElementById('status-panel');
	if (!panel) {
		reloadEnrollmentStatus();
		return;
	}

	const payload = await fetchEnrollmentStatus();
	if (!payload) {
		reloadEnrollmentStatus();
		return;
	}

	const outcome = await processStatusPayload(panel, payload);
	if (outcome !== 'reload' && payload.poll) {
		startEnrollmentPolling(panel);
	}
}

function schedulePollTick() {
	if (pollStopped || !pollPanel) return;
	if (pollTimer !== undefined) clearTimeout(pollTimer);
	const intervalMs = Number(pollPanel.dataset.pollInterval) || ENROLLMENT_POLL_INTERVAL_MS;
	pollTimer = setTimeout(() => {
		void pollTick();
	}, intervalMs);
}

async function pollTick() {
	if (pollStopped || pollInFlight || !pollPanel) return;

	const maxMs = Number(pollPanel.dataset.pollMax) || ENROLLMENT_POLL_MAX_MS;
	if (Date.now() - pollStartedAt >= maxMs) {
		stopEnrollmentPolling();
		return;
	}

	if (document.visibilityState === 'hidden') {
		schedulePollTick();
		return;
	}

	pollInFlight = true;
	try {
		if (pollPanel.dataset.signSurface === 'true') {
			const syncResult = await requestNdaSignatureRefresh();
			if (syncResult.signed) {
				await refreshEnrollmentAfterNdaSigned();
				return;
			}
		}

		// Pas encore de surface de signature (paiement en attente ou NDA pas
		// encore provisionné) : le GET de statut ne fait que lire la base. On
		// rejoue la réconciliation serveur pour faire progresser l'état même
		// sans webhook, en limitant la cadence des appels provider.
		const reconciled =
			pollPanel.dataset.signSurface !== 'true' &&
			Date.now() - lastReconcileAt >= ENROLLMENT_RECONCILE_INTERVAL_MS
				? await (async () => {
						lastReconcileAt = Date.now();
						return reconcileEnrollmentStatus();
					})()
				: null;

		const payload = reconciled ?? (await fetchEnrollmentStatus());
		if (payload && pollPanel && !pollStopped) {
			if (
				payload.hasSignSurface &&
				pollPanel.dataset.signSurface !== 'true' &&
				markReloadPending()
			) {
				stopEnrollmentPolling();
				window.location.hash = 'acces';
				window.location.reload();
				return;
			}
			await processStatusPayload(pollPanel, payload);
		}
	} catch {
		// A transient failure of the client reconciliation must not stop the
		// fallback poll; the next tick will retry the provider sync.
	} finally {
		pollInFlight = false;
	}

	if (!pollStopped) schedulePollTick();
}

function bindVisibilityListener() {
	if (visibilityListenerBound) return;
	visibilityListenerBound = true;
	document.addEventListener('visibilitychange', onVisibilityChange);
}

export function startEnrollmentPolling(panel: HTMLElement) {
	if (panel.dataset.poll !== 'true') return;

	stopEnrollmentPolling();
	pollStopped = false;
	pollPanel = panel;
	pollStartedAt = Date.now();
	lastReconcileAt = 0;
	bindVisibilityListener();
	schedulePollTick();
}

function onVisibilityChange() {
	if (document.visibilityState === 'visible' && !pollStopped && pollPanel) {
		// Un·e utilisateur·rice qui revient sur l'onglet (retour de signature
		// DocuSeal, attente longue) doit relancer la fenêtre de polling : sinon
		// une signature de plus de 3 min ne serait jamais détectée sans refresh.
		pollStartedAt = Date.now();
		void pollTick();
	}
}

export function cleanEnrollmentQueryParams() {
	const url = new URL(window.location.href);
	const keys = ['connected', 'link', 'checkout', 'session_id'] as const;
	let cleaned = false;

	for (const key of keys) {
		if (!url.searchParams.has(key)) continue;
		url.searchParams.delete(key);
		cleaned = true;
	}

	if (!cleaned) return;
	const next = `${url.pathname}${url.search}${url.hash}`;
	window.history.replaceState({}, '', next);
}

/** @internal test helper */
export function __resetEnrollmentStatusClientForTests() {
	stopEnrollmentPolling();
	lastReconcileAt = 0;
	reloadPending = false;
	if (reloadTimer !== undefined) {
		clearTimeout(reloadTimer);
		reloadTimer = undefined;
	}
}
