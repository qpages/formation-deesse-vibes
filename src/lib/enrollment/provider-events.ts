import type { Provider, ProviderEventStatus } from '../../generated/prisma/client';
import { encryptPayload } from '../crypto';
import { getPrisma } from '../prisma';

export type RecordedProviderEvent = {
	created: boolean;
	id?: string;
	status?: ProviderEventStatus;
};

/** Insert inbox event (status=received). Duplicate unique → created:false + existing row. */
export async function recordProviderEvent(input: {
	provider: Provider;
	providerEventId: string;
	eventType: string;
	enrollmentId?: string;
	payload: unknown;
}): Promise<RecordedProviderEvent> {
	const prisma = getPrisma();
	try {
		const row = await prisma.providerEvent.create({
			data: {
				provider: input.provider,
				providerEventId: input.providerEventId,
				eventType: input.eventType,
				status: 'received',
				enrollmentId: input.enrollmentId,
				payloadCipherText: encryptPayload(JSON.stringify(input.payload)),
			},
		});
		return { created: true, id: row.id, status: row.status };
	} catch (error) {
		if (
			typeof error === 'object' &&
			error &&
			'code' in error &&
			(error as { code: string }).code === 'P2002'
		) {
			const existing = await prisma.providerEvent.findUnique({
				where: {
					provider_providerEventId: {
						provider: input.provider,
						providerEventId: input.providerEventId,
					},
				},
			});
			return { created: false, id: existing?.id, status: existing?.status };
		}
		throw error;
	}
}

export async function markProviderEventProcessed(id: string, enrollmentId?: string | null) {
	await getPrisma().providerEvent.update({
		where: { id },
		data: {
			status: 'processed',
			processedAt: new Date(),
			lastError: null,
			...(enrollmentId ? { enrollmentId } : {}),
		},
	});
}

export async function markProviderEventIgnored(id: string) {
	await getPrisma().providerEvent.update({
		where: { id },
		data: { status: 'ignored', processedAt: new Date(), lastError: null },
	});
}

export async function markProviderEventFailed(id: string, error: string) {
	await getPrisma().providerEvent.update({
		where: { id },
		data: { status: 'failed', lastError: error.slice(0, 2000) },
	});
}

/** Purge des payloads webhook > 30 jours */
export async function purgeOldWebhookPayloads() {
	const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	await getPrisma().providerEvent.updateMany({
		where: { receivedAt: { lt: cutoff }, payloadCipherText: { not: null } },
		data: { payloadCipherText: null },
	});
}
