import type { APIRoute } from 'astro';
import {
	parseCookie,
	TRACKING_COOKIE,
	verifyEnrollmentSessionToken,
} from '../../../lib/auth/session';
import { findEnrollmentById } from '../../../lib/enrollment/queries';
import { json } from '../../../lib/http';
import { RATE_LIMITS, clientIp, enforceRateLimit, rateLimitKey } from '../../../lib/rate-limit';
import { formatErrorDetail, notifyOps } from '../../../lib/services/slack';
import { docusealAdapter } from '../../../lib/signature/adapters/docuseal';
import {
	isSubmitterCompleted,
	recentDocumentsCopySent,
	sendDocusealDocumentsCopy,
	submitterSlugFromEmbedSrc,
} from '../../../lib/signature/docuseal-send-copy';
import { resolveExternalSignerId, resolveNdaProvider, resolveSignKind } from '../../../lib/signature/nda-request';

export const prerender = false;

type NdaRequestMetadata = { embed_src?: string };

const SEND_COPY_ERROR =
	'Impossible d’envoyer la copie pour le moment. Réessayez dans quelques secondes.';
const SEND_COPY_COOLDOWN =
	'Une copie a déjà été envoyée récemment. Réessayez dans une trentaine de minutes.';
const SEND_COPY_SUCCESS =
	'Demande transmise à DocuSeal. La copie devrait arriver dans quelques minutes — pensez à vérifier vos spams.';

async function resolveSubmitter(enrollment: NonNullable<Awaited<ReturnType<typeof findEnrollmentById>>>) {
	const metadata = enrollment.ndaRequest?.metadata as NdaRequestMetadata | null;
	const fromEmbed = metadata?.embed_src ? submitterSlugFromEmbedSrc(metadata.embed_src) : null;

	const signerId = resolveExternalSignerId(enrollment);
	if (!signerId) return null;

	const submitter = await docusealAdapter.getSubmitter(signerId);
	const slug = fromEmbed ?? submitter.slug ?? null;
	if (!slug) return null;

	return { submitter, slug };
}

async function notifySendCopyFailure(
	enrollment: NonNullable<Awaited<ReturnType<typeof findEnrollmentById>>>,
	detail: string,
) {
	await notifyOps({
		kind: 'nda.monitor',
		severity: 'warn',
		title: 'Échec envoi copie NDA signé (DocuSeal)',
		enrollmentId: enrollment.id,
		email: enrollment.user.email,
		detail,
	});
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let enrollment: Awaited<ReturnType<typeof findEnrollmentById>> | null = null;
	try {
		const token = parseCookie(request.headers.get('cookie'), TRACKING_COOKIE);
		if (!token) {
			return json({ error: 'Session requise.' }, 401);
		}

		const enrollmentId = await verifyEnrollmentSessionToken(token);
		if (!enrollmentId) {
			return json({ error: 'Session invalide.' }, 401);
		}

		const limited = enforceRateLimit(
			rateLimitKey(RATE_LIMITS.ndaSendCopy, [clientIp(request, clientAddress), enrollmentId]),
			RATE_LIMITS.ndaSendCopy,
		);
		if (limited) return limited;

		enrollment = await findEnrollmentById(enrollmentId);
		if (!enrollment) {
			return json({ error: 'Inscription introuvable.' }, 404);
		}

		if (enrollment.contractStatus !== 'signed') {
			return json({ error: 'Le contrat n’est pas encore signé.' }, 409);
		}

		if (resolveNdaProvider(enrollment) !== 'docuseal' || resolveSignKind(enrollment) !== 'embed') {
			return json({ error: 'Action non disponible pour ce mode de signature.' }, 403);
		}

		const resolved = await resolveSubmitter(enrollment);
		if (!resolved) {
			await notifySendCopyFailure(enrollment, 'submitter introuvable');
			return json({ error: SEND_COPY_ERROR }, 502);
		}

		const { submitter, slug } = resolved;

		if (!isSubmitterCompleted(submitter)) {
			await notifySendCopyFailure(enrollment, 'submitter DocuSeal non complété');
			return json({ error: SEND_COPY_ERROR }, 409);
		}

		if (recentDocumentsCopySent(submitter)) {
			return json({ error: SEND_COPY_COOLDOWN }, 409);
		}

		await sendDocusealDocumentsCopy(slug);

		await notifyOps({
			kind: 'nda.copy_sent',
			severity: 'info',
			title: 'Demande d’envoi copie NDA transmise à DocuSeal',
			enrollmentId: enrollment.id,
			email: enrollment.user.email,
		});

		return json({
			ok: true,
			message: SEND_COPY_SUCCESS,
		});
	} catch (error) {
		console.error('[enrollment/nda-send-copy]', error);
		if (enrollment) {
			await notifySendCopyFailure(enrollment, formatErrorDetail(error));
		}
		return json({ error: SEND_COPY_ERROR }, 502);
	}
};
