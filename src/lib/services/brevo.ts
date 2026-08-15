import { e2eMockProviders } from '../e2e-providers';
import { FORMATION, getEnv, requireEnv } from '../env';

const BREVO_SMTP_URL = 'https://api.brevo.com/v3/smtp/email';

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

export async function sendMagicLinkEmail(input: { to: string; firstName: string; url: string }) {
	if (e2eMockProviders()) {
		return;
	}

	const env = getEnv();
	const apiKey = requireEnv('BREVO_API_KEY');
	const htmlUrl = escapeHtml(input.url);
	const firstName = escapeHtml(input.firstName);

	const response = await fetch(BREVO_SMTP_URL, {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'api-key': apiKey,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			sender: { email: env.BREVO_FROM, name: FORMATION.brand },
			to: [{ email: input.to, name: input.firstName }],
			subject: `Votre suivi — ${FORMATION.name}`,
			htmlContent: `
			<p>Bonjour ${firstName},</p>
			<p>Voici votre lien pour retrouver l’état de votre inscription à la ${FORMATION.name} :</p>
			<p><a href="${htmlUrl}">Voir mon inscription</a></p>
			<p>Ce lien expire dans 30 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>
			<p>— ${FORMATION.brand}</p>
		`,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Brevo API error ${response.status}: ${body}`);
	}
}
