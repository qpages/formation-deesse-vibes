/** Empêche un 2e clic tant que l’action en cours n’a pas fini. */
export function lockButton(
	button: HTMLButtonElement,
	options?: { busyLabel?: string },
): { locked: true; unlock: () => void } | { locked: false } {
	if (button.dataset.busy === '1') return { locked: false };

	button.dataset.busy = '1';
	button.setAttribute('aria-busy', 'true');

	const snapshot = {
		disabled: button.disabled,
		text: button.textContent,
	};

	button.disabled = true;
	if (options?.busyLabel) button.textContent = options.busyLabel;

	return {
		locked: true,
		unlock() {
			button.dataset.busy = '0';
			button.removeAttribute('aria-busy');
			button.disabled = snapshot.disabled;
			button.textContent = snapshot.text;
		},
	};
}
