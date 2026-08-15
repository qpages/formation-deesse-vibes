/** JSON Response helper for API routes. */
export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...extraHeaders,
		},
	});
}
