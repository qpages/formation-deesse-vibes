import { e2eMockProviders } from '../e2e-providers';
import { FORMATION, getEnv, requireEnv } from '../env';
import { WHATSAPP_PAST_DUE_MESSAGE, whatsappHelpHref } from '../whatsapp';

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
			subject: `Votre inscription — ${FORMATION.name}`,
			htmlContent: `
			<p>Bonjour ${firstName},</p>
			<p>Voici le lien pour ouvrir votre espace d’inscription sur formation.jessica-stamck.com :</p>
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

export async function sendPastDueSuspensionEmail(input: { to: string; firstName: string }) {
	if (e2eMockProviders()) {
		return;
	}

	const env = getEnv();
	const apiKey = requireEnv('BREVO_API_KEY');
	const firstName = escapeHtml(input.firstName);
	const whatsappHref = whatsappHelpHref(env.PUBLIC_WHATSAPP_NUMBER, WHATSAPP_PAST_DUE_MESSAGE);
	const contactEmail = escapeHtml(env.PUBLIC_ADMIN_CONTACT_EMAIL);
	const contactBlock = whatsappHref
		? `<p><a href="${escapeHtml(whatsappHref)}">Contacter l’administratrice sur WhatsApp</a></p>`
		: `<p>Contactez-nous à <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>`;

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
			subject: `Accès formation temporairement suspendu — ${FORMATION.name}`,
			htmlContent: `
			<p>Bonjour ${firstName},</p>
			<p>Votre accès à la formation est temporairement désactivé le temps de régulariser la situation sur le paiement.</p>
			<p>Dès réception de votre règlement, votre accès sera rétabli automatiquement.</p>
			${contactBlock}
			<p>— ${FORMATION.brand}</p>
		`,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Brevo API error ${response.status}: ${body}`);
	}
}
