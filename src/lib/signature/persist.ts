import type {
	ContractStatus,
	YousignRequestStatus,
	YousignSignerStatus,
} from '../../generated/prisma/client';
import { getEnv } from '../env';
import { getPrisma } from '../prisma';

const ERROR_MAX_LEN = 1000;

function truncateError(message: string): string {
	return message.slice(0, ERROR_MAX_LEN);
}

function isDocusealProvider(): boolean {
	return getEnv().SIGNATURE_PROVIDER === 'docuseal';
}

const withUserAndNda = { include: { user: true, ndaRequest: true } } as const;

export async function persistNdaDraftRequestId(enrollmentId: string, requestId: string) {
	const prisma = getPrisma();
	return prisma.$transaction(async (tx) => {
		if (isDocusealProvider()) {
			await tx.ndaRequest.upsert({
				where: { enrollmentId },
				create: {
					enrollmentId,
					provider: 'docuseal',
					externalRequestId: requestId,
					signKind: 'embed',
				},
				update: {
					provider: 'docuseal',
					externalRequestId: requestId,
					externalSignerId: null,
					signKind: 'embed',
					providerStatus: null,
					lastError: null,
					lastErrorAt: null,
				},
			});
			return tx.enrollment.findUniqueOrThrow({
				where: { id: enrollmentId },
				...withUserAndNda,
			});
		}

		const enrollment = await tx.enrollment.update({
			where: { id: enrollmentId },
			data: { yousignRequestId: requestId },
			include: { user: true, ndaRequest: true },
		});

		await tx.ndaRequest.upsert({
			where: { enrollmentId },
			create: {
				enrollmentId,
				provider: 'yousign',
				externalRequestId: requestId,
				signKind: 'redirect',
			},
			update: {
				externalRequestId: requestId,
				externalSignerId: null,
				providerStatus: null,
				lastError: null,
				lastErrorAt: null,
			},
		});

		return enrollment;
	});
}

export async function persistNdaProvisioned(
	enrollmentId: string,
	nda: { requestId: string; signerId: string; signatureLink?: string },
) {
	const prisma = getPrisma();
	const metadata =
		isDocusealProvider() && nda.signatureLink ? { embed_src: nda.signatureLink } : undefined;

	return prisma.$transaction(async (tx) => {
		if (isDocusealProvider()) {
			const enrollment = await tx.enrollment.update({
				where: { id: enrollmentId },
				data: {
					contractStatus: 'sent',
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
					provider: 'docuseal',
					externalRequestId: nda.requestId,
					externalSignerId: nda.signerId,
					signKind: 'embed',
					metadata,
				},
				update: {
					externalRequestId: nda.requestId,
					externalSignerId: nda.signerId,
					signKind: 'embed',
					metadata,
					lastError: null,
					lastErrorAt: null,
				},
			});

			return enrollment;
		}

		const enrollment = await tx.enrollment.update({
			where: { id: enrollmentId },
			data: {
				yousignRequestId: nda.requestId,
				yousignSignerId: nda.signerId,
				yousignStatus: 'ongoing',
				contractStatus: 'sent',
				yousignSignerStatus: null,
				signatureLinkExpiresAt: null,
				ndaNotifiedAt: null,
				ndaLinkOpenedAt: null,
				ndaSignedAt: null,
				ndaDeliveryFailedAt: null,
				yousignLastError: null,
				yousignLastErrorAt: null,
			},
			include: { user: true, ndaRequest: true },
		});

		await tx.ndaRequest.upsert({
			where: { enrollmentId },
			create: {
				enrollmentId,
				provider: 'yousign',
				externalRequestId: nda.requestId,
				externalSignerId: nda.signerId,
				signKind: 'redirect',
			},
			update: {
				externalRequestId: nda.requestId,
				externalSignerId: nda.signerId,
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
				yousignRequestId: null,
				yousignSignerId: null,
				yousignStatus: null,
				yousignSignerStatus: null,
				signatureLinkExpiresAt: null,
				ndaNotifiedAt: null,
				ndaLinkOpenedAt: null,
				ndaSignedAt: null,
				ndaDeliveryFailedAt: null,
				yousignLastError: null,
				yousignLastErrorAt: null,
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
		const data = {
			yousignLastError: truncated,
			yousignLastErrorAt: at,
		};

		await prisma.$transaction(async (tx) => {
			await tx.enrollment.update({
				where: { id: enrollmentId },
				data,
			});
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

/** @deprecated Préférer recordNdaError */
export const recordYousignError = recordNdaError;

/** Dual-write sync mirror: enrollment yousign* + nda_requests providerStatus / lastError. */
export async function persistNdaSyncMirror(
	enrollmentId: string,
	data: {
		yousignStatus?: YousignRequestStatus;
		contractStatus?: ContractStatus;
		providerStatus?: string | null;
		yousignSignerId?: string | null;
		yousignSignerStatus?: YousignSignerStatus | null;
		signatureLinkExpiresAt?: Date | null;
		ndaNotifiedAt?: Date | null;
		ndaSignedAt?: Date | null;
		yousignLastError?: string | null;
		yousignLastErrorAt?: Date | null;
	},
) {
	const prisma = getPrisma();
	return prisma.$transaction(async (tx) => {
		const enrollment = await tx.enrollment.update({
			where: { id: enrollmentId },
			data: {
				...(data.yousignStatus !== undefined ? { yousignStatus: data.yousignStatus } : {}),
				...(data.contractStatus ? { contractStatus: data.contractStatus } : {}),
				...(data.yousignSignerId !== undefined ? { yousignSignerId: data.yousignSignerId } : {}),
				...(data.yousignSignerStatus !== undefined
					? { yousignSignerStatus: data.yousignSignerStatus }
					: {}),
				...(data.signatureLinkExpiresAt !== undefined
					? { signatureLinkExpiresAt: data.signatureLinkExpiresAt }
					: {}),
				...(data.ndaNotifiedAt !== undefined ? { ndaNotifiedAt: data.ndaNotifiedAt } : {}),
				...(data.ndaSignedAt !== undefined ? { ndaSignedAt: data.ndaSignedAt } : {}),
				...(data.yousignLastError !== undefined ? { yousignLastError: data.yousignLastError } : {}),
				...(data.yousignLastErrorAt !== undefined
					? { yousignLastErrorAt: data.yousignLastErrorAt }
					: {}),
			},
			include: { user: true, ndaRequest: true },
		});

		const ndaUpdate: {
			providerStatus?: string | null;
			lastError?: string | null;
			lastErrorAt?: Date | null;
		} = {};
		if (data.providerStatus !== undefined) ndaUpdate.providerStatus = data.providerStatus;
		if (data.yousignLastError === null) {
			ndaUpdate.lastError = null;
			ndaUpdate.lastErrorAt = null;
		} else if (data.yousignLastError !== undefined) {
			ndaUpdate.lastError = truncateError(data.yousignLastError);
			ndaUpdate.lastErrorAt = data.yousignLastErrorAt ?? new Date();
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

/** Sync mirror DocuSeal : contractStatus + nda_requests, sans yousign*. */
export async function persistDocusealSyncMirror(
	enrollmentId: string,
	data: {
		contractStatus?: ContractStatus;
		providerStatus?: string | null;
		ndaSignedAt?: Date | null;
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
				...(data.ndaSignedAt !== undefined ? { ndaSignedAt: data.ndaSignedAt } : {}),
			},
			include: { user: true, ndaRequest: true },
		});

		const ndaUpdate: {
			providerStatus?: string | null;
			lastError?: string | null;
			lastErrorAt?: Date | null;
		} = {};
		if (data.providerStatus !== undefined) ndaUpdate.providerStatus = data.providerStatus;
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
