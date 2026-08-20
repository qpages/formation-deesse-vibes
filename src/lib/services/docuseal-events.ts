import { decryptPayload } from '../crypto';
import { resolveSignatureProvider } from '../signature/providers';
import type { DocusealWebhookPayload } from '../signature/adapters/docuseal-types';
import { confirmLearnerNdaSignatureFromWebhook } from '../signature/nda-sync';
import { findEnrollmentByExternalRequestOrEnrollmentId } from '../enrollment/queries';

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
	const completed = resolveSignatureProvider('docuseal').mapCompletedEvent(payload);
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

	return confirmLearnerNdaSignatureFromWebhook(enrollment.id);
}
