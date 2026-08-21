/** Expand Stripe string | { id } unions (accepts unknown webhook payloads). */
export function stripeId(ref: unknown): string | undefined {
	if (!ref) return undefined;
	if (typeof ref === 'string') return ref;
	if (typeof ref === 'object' && ref !== null && 'id' in ref && typeof ref.id === 'string') {
		return ref.id;
	}
	return undefined;
}
