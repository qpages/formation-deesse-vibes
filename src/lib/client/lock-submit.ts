/** Empêche un 2e submit tant que le 1er n’a pas fini (double-clic / Enter). */
export function lockFormSubmit(
	form: HTMLFormElement,
	options?: { busyLabel?: string },
): { locked: true; unlock: () => void } | { locked: false } {
	if (form.dataset.submitting === '1') return { locked: false };

	form.dataset.submitting = '1';
	form.setAttribute('aria-busy', 'true');

	const buttons = [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];
	const snapshot = buttons.map((button) => ({
		button,
		disabled: button.disabled,
		text: button.textContent,
	}));

	for (const { button } of snapshot) {
		button.disabled = true;
		if (options?.busyLabel) button.textContent = options.busyLabel;
	}

	return {
		locked: true,
		unlock() {
			form.dataset.submitting = '0';
			form.removeAttribute('aria-busy');
			for (const item of snapshot) {
				item.button.disabled = item.disabled;
				item.button.textContent = item.text;
			}
		},
	};
}
