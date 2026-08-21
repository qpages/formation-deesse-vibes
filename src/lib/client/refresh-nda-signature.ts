export type NdaSignatureRefreshResponse = {
	ok?: boolean;
	signed?: boolean;
	error?: string;
	message?: string;
};

export type NdaSignatureRefreshResult = { signed: true } | { signed: false; message: string };

/** Requests a server-side refresh of the current enrollment's NDA signature state. */
export async function requestNdaSignatureRefresh(): Promise<NdaSignatureRefreshResult> {
	const res = await fetch('/api/enrollment/nda-signature/refresh', {
		method: 'POST',
		headers: { Accept: 'application/json' },
		credentials: 'same-origin',
	});
	const data = (await res.json().catch(() => ({}))) as NdaSignatureRefreshResponse;
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
