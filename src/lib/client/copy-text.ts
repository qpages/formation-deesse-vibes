/** Copie une chaîne dans le presse-papiers (API Clipboard + fallback execCommand). */
export async function copyText(value: string): Promise<'copied' | 'failed'> {
	try {
		await navigator.clipboard.writeText(value);
		return 'copied';
	} catch {
		try {
			const textarea = document.createElement('textarea');
			textarea.value = value;
			textarea.setAttribute('readonly', '');
			textarea.style.position = 'fixed';
			textarea.style.left = '-9999px';
			document.body.appendChild(textarea);
			textarea.select();
			const ok = document.execCommand('copy');
			document.body.removeChild(textarea);
			return ok ? 'copied' : 'failed';
		} catch {
			return 'failed';
		}
	}
}
