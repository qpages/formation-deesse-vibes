import { decryptPayload } from '../crypto';
import { docusealAdapter } from '../signature/adapters/docuseal';
import type { DocusealWebhookPayload } from '../signature/adapters/docuseal-types';
import { ensureTeachizyAfterSignature } from '../signature/after-signature';
import { formatNdaSignedTitle } from '../signature/format-nda-signed-title';
import { persistNdaSyncMirror } from '../signature/persist';
import { findEnrollmentByExternalRequestOrEnrollmentId } from '../enrollment/queries';
import { notifyOps } from './slack';

export type { DocusealWebhookPayload } from '../signature/adapters/docuseal-types';

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
		'none';
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
		throw new Error('DocuSeal webhook sans request id');
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

	await persistNdaSyncMirror(enrollment.id, {
		contractStatus: 'signed',
		providerStatus: 'completed',
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
	);
	if (followUp.status === 'failed') {
		throw new Error(`Enqueue Teachizy échoué: ${followUp.error}`);
	}

	return { enrollmentId: enrollment.id };
}
