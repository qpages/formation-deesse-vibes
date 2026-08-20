export type NdaSyncResponse = {
	ok?: boolean;
	signed?: boolean;
	error?: string;
	message?: string;
};

export type NdaSyncResult = { signed: true } | { signed: false; message: string };

/** POST /api/enrollment/nda-sync — aligne la signature NDA côté serveur. */
export async function syncNdaSignature(): Promise<NdaSyncResult> {
	const res = await fetch('/api/enrollment/nda-sync', {
		method: 'POST',
		headers: { Accept: 'application/json' },
		credentials: 'same-origin',
	});
	const data = (await res.json().catch(() => ({}))) as NdaSyncResponse;
	if (res.ok && data.signed) {
		return { signed: true };
	}
	return {
		signed: false,
		message:
			data.message ??
			data.error ??
			'La signature n’est pas encore enregistrée. Réessaie dans quelques secondes.',
	};
}

export function reloadAfterNdaSigned() {
	window.location.hash = 'acces';
	window.location.reload();
}
