export const WHATSAPP_HELP_MESSAGE = "Bonjour, j'ai besoin d'aide pour ";

export function whatsappHelpHref(number: string | undefined): string | undefined {
	if (!number) return undefined;
	return `https://wa.me/${number}?text=${encodeURIComponent(WHATSAPP_HELP_MESSAGE)}`;
}
