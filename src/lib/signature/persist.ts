import type { ContractStatus } from '../../generated/prisma/client';
import { getPrisma } from '../prisma';
import { resolveSignatureConfig } from './config';

const ERROR_MAX_LEN = 1000;

function truncateError(message: string): string {
	return message.slice(0, ERROR_MAX_LEN);
}

const withUserAndNda = { include: { user: true, ndaRequest: true } } as const;

export async function persistNdaDraftRequestId(enrollmentId: string, requestId: string) {
	const { provider, signKind } = resolveSignatureConfig();
	const prisma = getPrisma();

	return prisma.$transaction(async (tx) => {
		await tx.ndaRequest.upsert({
			where: { enrollmentId },
			create: {
				enrollmentId,
				provider,
				externalRequestId: requestId,
				signKind,
			},
			update: {
				provider,
				externalRequestId: requestId,
				externalSignerId: null,
				signKind,
				providerStatus: null,
				lastError: null,
				lastErrorAt: null,
			},
		});

		return tx.enrollment.findUniqueOrThrow({
			where: { id: enrollmentId },
			...withUserAndNda,
		});
	});
}

export async function persistNdaProvisioned(
	enrollmentId: string,
	nda: { requestId: string; signerId: string; signatureLink?: string },
) {
	const { provider, signKind } = resolveSignatureConfig();
	const metadata =
		signKind === 'embed' && nda.signatureLink ? { embed_src: nda.signatureLink } : undefined;
	const prisma = getPrisma();

	return prisma.$transaction(async (tx) => {
		const enrollment = await tx.enrollment.update({
			where: { id: enrollmentId },
			data: {
				contractStatus: 'sent',
				signatureLinkExpiresAt: null,
				ndaNotifiedAt: null,
				ndaLinkOpenedAt: null,
				ndaSignedAt: null,
				ndaDeliveryFailedAt: null,
			},
			include: { user: true, ndaRequest: true },
		});

		await tx.ndaRequest.upsert({
			where: { enrollmentId },
			create: {
				enrollmentId,
				provider,
				externalRequestId: nda.requestId,
				externalSignerId: nda.signerId,
				signKind,
				metadata,
			},
			update: {
				provider,
				externalRequestId: nda.requestId,
				externalSignerId: nda.signerId,
				signKind,
				metadata,
				lastError: null,
				lastErrorAt: null,
			},
		});

		return enrollment;
	});
}

/** Clear NDA ids without calling provider cancel (recreate NDA). */
export async function clearNdaFields(enrollmentId: string) {
	const prisma = getPrisma();
	return prisma.$transaction(async (tx) => {
		await tx.ndaRequest.deleteMany({ where: { enrollmentId } });

		return tx.enrollment.update({
			where: { id: enrollmentId },
			data: {
				signatureLinkExpiresAt: null,
				ndaNotifiedAt: null,
				ndaLinkOpenedAt: null,
				ndaSignedAt: null,
				ndaDeliveryFailedAt: null,
				contractStatus: 'pending',
			},
			...withUserAndNda,
		});
	});
}

/** Persiste la dernière erreur NDA pour diagnostic admin. Ne throw jamais. */
export async function recordNdaError(enrollmentId: string, message: string) {
	try {
		const prisma = getPrisma();
		const truncated = truncateError(message);
		const at = new Date();

		await prisma.$transaction(async (tx) => {
			await tx.enrollment.updateMany({
				where: { id: enrollmentId, contractStatus: 'pending' },
				data: { contractStatus: 'error' },
			});
			await tx.ndaRequest.updateMany({
				where: { enrollmentId },
				data: { lastError: truncated, lastErrorAt: at },
			});
		});
	} catch (error) {
		console.error('[recordNdaError] persist failed', error);
	}
}

/** Sync mirror: enrollment contract/timestamps + nda_requests providerStatus / lastError. */
export async function persistNdaSyncMirror(
	enrollmentId: string,
	data: {
		contractStatus?: ContractStatus;
		providerStatus?: string | null;
		externalSignerId?: string | null;
		signatureLinkExpiresAt?: Date | null;
		ndaNotifiedAt?: Date | null;
		ndaLinkOpenedAt?: Date | null;
		ndaSignedAt?: Date | null;
		ndaDeliveryFailedAt?: Date | null;
		lastError?: string | null;
		lastErrorAt?: Date | null;
	},
) {
	const prisma = getPrisma();
	return prisma.$transaction(async (tx) => {
		const enrollment = await tx.enrollment.update({
			where: { id: enrollmentId },
			data: {
				...(data.contractStatus ? { contractStatus: data.contractStatus } : {}),
				...(data.signatureLinkExpiresAt !== undefined
					? { signatureLinkExpiresAt: data.signatureLinkExpiresAt }
					: {}),
				...(data.ndaNotifiedAt !== undefined ? { ndaNotifiedAt: data.ndaNotifiedAt } : {}),
				...(data.ndaLinkOpenedAt !== undefined ? { ndaLinkOpenedAt: data.ndaLinkOpenedAt } : {}),
				...(data.ndaSignedAt !== undefined ? { ndaSignedAt: data.ndaSignedAt } : {}),
				...(data.ndaDeliveryFailedAt !== undefined
					? { ndaDeliveryFailedAt: data.ndaDeliveryFailedAt }
					: {}),
			},
			include: { user: true, ndaRequest: true },
		});

		const ndaUpdate: {
			providerStatus?: string | null;
			externalSignerId?: string | null;
			lastError?: string | null;
			lastErrorAt?: Date | null;
		} = {};
		if (data.providerStatus !== undefined) ndaUpdate.providerStatus = data.providerStatus;
		if (data.externalSignerId !== undefined) ndaUpdate.externalSignerId = data.externalSignerId;
		if (data.lastError === null) {
			ndaUpdate.lastError = null;
			ndaUpdate.lastErrorAt = null;
		} else if (data.lastError !== undefined) {
			ndaUpdate.lastError = truncateError(data.lastError);
			ndaUpdate.lastErrorAt = data.lastErrorAt ?? new Date();
		}

		if (Object.keys(ndaUpdate).length > 0) {
			await tx.ndaRequest.updateMany({
				where: { enrollmentId },
				data: ndaUpdate,
			});
		}

		return enrollment;
	});
}
