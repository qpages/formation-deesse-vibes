/**
 * Snapshot sérialisable de l'inscription utilisé par le navigateur pour
 * déterminer si un rechargement SSR est nécessaire. Ce module doit rester pur :
 * aucun import Prisma, provider ou accès base de données.
 */
export type EnrollmentStatusSnapshot = {
	collectionStatus: string;
	contractStatus: string;
	accessStatus: string;
	hasSignSurface: boolean;
	signSurfaceKind: 'embed' | 'redirect' | null;
	signSurfaceProvider?: 'docuseal' | 'yousign' | null;
};

export function enrollmentFingerprint(
	statuses: Pick<EnrollmentStatusSnapshot, 'collectionStatus' | 'contractStatus' | 'accessStatus'>,
): string {
	return `${statuses.collectionStatus}|${statuses.contractStatus}|${statuses.accessStatus}`;
}

/** Structural UI changes (embed DocuSeal, lien Yousign, accès actif) need a full reload. */
export function statusUpdateRequiresReload(
	before: EnrollmentStatusSnapshot,
	after: EnrollmentStatusSnapshot,
): boolean {
	if (before.hasSignSurface !== after.hasSignSurface) return true;
	if (before.signSurfaceKind !== after.signSurfaceKind) return true;
	if (before.signSurfaceProvider !== after.signSurfaceProvider) return true;
	if (before.contractStatus === 'pending' && after.contractStatus === 'sent') return true;
	if (before.contractStatus !== 'signed' && after.contractStatus === 'signed') return true;
	if (before.accessStatus !== 'active' && after.accessStatus === 'active') return true;
	return false;
}

export function snapshotFromPayload(payload: EnrollmentStatusSnapshot): EnrollmentStatusSnapshot {
	return {
		collectionStatus: payload.collectionStatus,
		contractStatus: payload.contractStatus,
		accessStatus: payload.accessStatus,
		hasSignSurface: payload.hasSignSurface,
		signSurfaceKind: payload.signSurfaceKind,
		signSurfaceProvider: payload.signSurfaceProvider ?? null,
	};
}

export function snapshotFromPanel(panel: HTMLElement): EnrollmentStatusSnapshot {
	return {
		collectionStatus: panel.dataset.collectionStatus ?? '',
		contractStatus: panel.dataset.contractStatus ?? '',
		accessStatus: panel.dataset.accessStatus ?? '',
		hasSignSurface: panel.dataset.signSurface === 'true',
		signSurfaceKind:
			panel.dataset.signSurfaceKind === 'embed' || panel.dataset.signSurfaceKind === 'redirect'
				? panel.dataset.signSurfaceKind
				: null,
		signSurfaceProvider:
			panel.dataset.signSurfaceProvider === 'docuseal' ||
			panel.dataset.signSurfaceProvider === 'yousign'
				? panel.dataset.signSurfaceProvider
				: null,
	};
}
