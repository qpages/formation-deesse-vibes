export const WHATSAPP_HELP_MESSAGE = "Bonjour, j'ai besoin d'aide pour ";

export const WHATSAPP_PAST_DUE_MESSAGE =
	'Bonjour, je souhaite régulariser ma situation de paiement pour ma formation.';

export function whatsappHelpHref(
	number: string | undefined,
	message: string = WHATSAPP_HELP_MESSAGE,
): string | undefined {
	if (!number) return undefined;
	return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
