import type { AdminActionMetaClient } from '../../lib/admin/actions';

const confirmBtnPrimary =
	'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush disabled:pointer-events-none disabled:opacity-50 h-10 px-4 text-sm text-mist bg-ink hover:bg-ink-soft shadow-[0_12px_30px_rgb(26_20_16/0.18)]';

declare global {
	interface Window {
		toast?: (message: string, variant?: string) => void;
	}
}

export function bindAdminActions(actionMeta: AdminActionMetaClient) {
	const dialog = document.getElementById('admin-action-dialog') as HTMLDialogElement | null;
	const eyebrowEl = dialog?.querySelector('[data-dialog-eyebrow]');
	const titleEl = dialog?.querySelector('[data-dialog-title]');
	const descEl = dialog?.querySelector('[data-dialog-description]');
	const confirmBtn = document.getElementById('admin-dialog-confirm') as HTMLButtonElement | null;
	const cancelBtn = document.getElementById('admin-dialog-cancel') as HTMLButtonElement | null;
	const closeBtn = dialog?.querySelector('[data-dialog-close]') as HTMLButtonElement | null;

	let busy = false;
	let pendingConfirmLabel = 'Confirmer';

	dialog?.addEventListener('cancel', (event) => {
		if (busy) event.preventDefault();
	});

	function toast(message: string, variant = 'info') {
		window.toast?.(message, variant);
	}

	function setBusy(next: boolean) {
		busy = next;
		if (confirmBtn) {
			confirmBtn.disabled = next;
			confirmBtn.textContent = next ? 'En cours…' : pendingConfirmLabel;
		}
		if (cancelBtn) cancelBtn.disabled = next;
		if (closeBtn) closeBtn.disabled = next;
	}

	function closeDialog() {
		dialog?.close();
		setBusy(false);
	}

	function fillDescription(template: string, name: string) {
		return template.replaceAll('{name}', name || 'cette personne');
	}

	function askConfirm(action: string, name: string) {
		const meta = actionMeta[action as keyof AdminActionMetaClient];
		if (!dialog || !meta) return Promise.resolve(false);

		pendingConfirmLabel = meta.confirm;
		if (eyebrowEl) eyebrowEl.textContent = meta.eyebrow;
		if (titleEl) titleEl.textContent = meta.title;
		if (descEl) descEl.textContent = fillDescription(meta.description, name);
		if (confirmBtn) {
			confirmBtn.textContent = meta.confirm;
			confirmBtn.className = confirmBtnPrimary;
		}

		setBusy(false);
		dialog.showModal();
		confirmBtn?.focus();

		return new Promise<boolean>((resolve) => {
			let settled = false;

			const finish = (value: boolean) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (!value && dialog.open) dialog.close();
				resolve(value);
			};

			const onConfirm = () => {
				if (busy) return;
				finish(true);
			};
			const onCancel = () => {
				if (busy) return;
				finish(false);
			};
			const onClose = () => finish(false);

			const onBackdrop = (event: MouseEvent) => {
				if (busy) return;
				if (event.target === dialog) finish(false);
			};

			const cleanup = () => {
				confirmBtn?.removeEventListener('click', onConfirm);
				cancelBtn?.removeEventListener('click', onCancel);
				closeBtn?.removeEventListener('click', onCancel);
				dialog.removeEventListener('click', onBackdrop);
				dialog.removeEventListener('close', onClose);
			};

			confirmBtn?.addEventListener('click', onConfirm);
			cancelBtn?.addEventListener('click', onCancel);
			closeBtn?.addEventListener('click', onCancel);
			dialog.addEventListener('click', onBackdrop);
			dialog.addEventListener('close', onClose);
		});
	}

	async function runAdminAction(enrollmentId: string, action: string, name: string) {
		if (!(action in actionMeta)) return false;

		const confirmed = await askConfirm(action, name);
		if (!confirmed) return false;

		setBusy(true);

		try {
			const res = await fetch('/api/admin/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enrollmentId, action }),
			});
			const json = await res.json();

			closeDialog();

			if (res.ok) {
				const variant =
					json.toast === 'info' || json.toast === 'error' ? json.toast : 'success';
				toast(json.message || 'Action effectuée.', variant);
				window.setTimeout(() => location.reload(), 700);
				return true;
			}

			toast(json.error || 'Échec de l’action.', 'error');
			return false;
		} catch {
			closeDialog();
			toast('Erreur réseau. Réessayez.', 'error');
			return false;
		}
	}

	document.querySelectorAll('[data-action]').forEach((btn) => {
		btn.addEventListener('click', async (event) => {
			event.stopPropagation();
			const action = btn.getAttribute('data-action');
			const wrap = btn.closest('[data-action-zone]') ?? btn.closest('[data-enrollment]');
			const enrollmentId = wrap?.getAttribute('data-enrollment');
			const name = wrap?.getAttribute('data-name') ?? '';
			if (!action || !enrollmentId) return;
			await runAdminAction(enrollmentId, action, name);
		});
	});
}
