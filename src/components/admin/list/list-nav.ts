/** Clic row / carte → fiche (sauf zone actions). */
export function bindEnrollmentListNavigation() {
	const interactive = 'a, button, input, select, textarea, [data-action-zone]';

	document.querySelectorAll<HTMLElement>('[data-enrollment-href]').forEach((row) => {
		const href = row.getAttribute('data-enrollment-href');
		if (!href) return;

		const go = () => window.location.assign(href);

		row.addEventListener('click', (event) => {
			const target = event.target as Element | null;
			if (target?.closest(interactive)) return;
			go();
		});

		row.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			if ((event.target as Element | null)?.closest(interactive)) return;
			event.preventDefault();
			go();
		});
	});
}
