import { Resend } from 'resend';
import { FORMATION, getEnv, requireEnv } from '../env';

let client: Resend | null = null;

function getResend() {
	if (!client) client = new Resend(requireEnv('RESEND_API_KEY'));
	return client;
}

export async function sendMagicLinkEmail(input: {
	to: string;
	firstName: string;
	url: string;
}) {
	const env = getEnv();
	await getResend().emails.send({
		from: env.RESEND_FROM,
		to: input.to,
		subject: `Votre suivi — ${FORMATION.name}`,
		html: `
			<p>Bonjour ${input.firstName},</p>
			<p>Voici votre lien pour retrouver l’état de votre inscription à la ${FORMATION.name} :</p>
			<p><a href="${input.url}">Voir mon inscription</a></p>
			<p>Ce lien expire dans 30 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>
			<p>— ${FORMATION.brand}</p>
		`,
	});
}
