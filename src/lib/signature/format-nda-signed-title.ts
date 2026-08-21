export function formatNdaSignedTitle(firstName: string, lastName: string, at = new Date()): string {
	const name = `${firstName} ${lastName}`.trim() || 'Un acheteur';
	const when = at.toLocaleString('fr-FR', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	});
	return `${name} a signé le contrat de confidentialité le ${when}`;
}
