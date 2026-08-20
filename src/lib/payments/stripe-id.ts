/** Expand Stripe string | { id } unions. */
export function stripeId(ref: string | { id: string } | null | undefined): string | undefined {
	if (!ref) return undefined;
	return typeof ref === 'string' ? ref : ref.id;
}
