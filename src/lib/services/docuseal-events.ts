import { decryptPayload } from '../crypto';
import { docusealAdapter } from '../signature/adapters/docuseal';
import { ensureTeachizyAfterSignature } from '../signature/after-signature';
import { findEnrollmentByExternalRequestOrEnrollmentId } from './enrollment-queries';
import { updateEnrollmentYousignMirror } from './enrollment';
import { notifyOps } from './slack';

export type DocusealWebhookPayload = {
	event_type?: string;
	timestamp?: string;
	data?: {
		id?: number;
		submission_id?: number;
		external_id?: string | null;
		completed_at?: string | null;
		submitters?: Array<{ external_id?: string | null }>;
		submission?: {
			id?: number;
			external_id?: string | null;
			status?: string;
			completed_at?: string | null;
		};
	};
};

function formatNdaSignedTitle(firstName: string, lastName: string, at = new Date()) {
	const name = `${firstName} ${lastName}`.trim() || 'Un acheteur';
	const when = at.toLocaleString('fr-FR', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	});
	return `${name} a signé le contrat de confidentialité le ${when}`;
}

export function isHandledDocusealEventType(eventType: string) {
	return eventType === 'form.completed' || eventType === 'submission.completed';
}

export function synthesizeDocusealProviderEventId(payload: DocusealWebhookPayload): string {
	const eventType = payload.event_type ?? 'unknown';
	const entityId =
		eventType === 'submission.completed'
			? (payload.data?.id ?? 'none')
			: (payload.data?.id ?? payload.data?.submission?.id ?? 'none');
	const completedAt =
		payload.data?.completed_at ??
		payload.data?.submission?.completed_at ??
		payload.timestamp ??
		'unknown';
	return `${eventType}:${entityId}:${completedAt}`;
}

export async function handleDocusealProviderEvent(input: {
	providerEventId: string;
	eventType: string;
	payloadCipherText: string | null;
}): Promise<{ enrollmentId?: string; ignored?: boolean }> {
	if (!isHandledDocusealEventType(input.eventType)) {
		return { ignored: true };
	}
	if (!input.payloadCipherText) {
		throw new Error('ProviderEvent sans payload');
	}

	const payload = JSON.parse(decryptPayload(input.payloadCipherText)) as DocusealWebhookPayload;
	const completed = docusealAdapter.mapCompletedEvent(payload);
	if (!completed) {
		return { ignored: true };
	}

	const enrollment = await findEnrollmentByExternalRequestOrEnrollmentId(
		'docuseal',
		completed.requestId,
		completed.externalId,
	);
	if (!enrollment) {
		throw new Error(`Enrollment introuvable pour DocuSeal ${completed.requestId}`);
	}

	const becameSigned = enrollment.contractStatus !== 'signed';
	const at = completed.occurredAt;

	await updateEnrollmentYousignMirror(enrollment.id, {
		contractStatus: 'signed',
		ndaSignedAt: enrollment.ndaSignedAt ?? at,
	});

	if (becameSigned) {
		await notifyOps({
			kind: 'nda.signed',
			severity: 'info',
			title: formatNdaSignedTitle(enrollment.user.firstName, enrollment.user.lastName, at),
			enrollmentId: enrollment.id,
			email: enrollment.user.email,
		});
	}

	const followUp = await ensureTeachizyAfterSignature(
		enrollment.id,
		input.providerEventId,
		completed.requestId,
		{ provider: 'docuseal' },
	);
	if (followUp.status === 'failed') {
		throw new Error(`Enqueue Teachizy échoué: ${followUp.error}`);
	}

	return { enrollmentId: enrollment.id };
}
