import type { Enrollment } from '../../generated/prisma/client';
import type { EnrollmentWithUser } from './queries';
import { isPaidEnough } from '../enrollment-gates';
import { resolveAwaitingNdaSignSurface } from './awaiting-nda-sign-surface';
import { ensureNdaContractSentIfProvisioned } from '../signature/persist';
import type { SignSurface } from '../signature/types';
import { primaryAction, shouldPollEnrollment, statusMessage, type PrimaryAction } from '../status';
import { enrollmentFingerprint } from '../status/snapshot';
import type { EnrollmentStatusSnapshot } from '../status/snapshot';

export {
	enrollmentFingerprint,
	snapshotFromPanel,
	snapshotFromPayload,
	statusUpdateRequiresReload,
} from '../status/snapshot';
export type { EnrollmentStatusSnapshot } from '../status/snapshot';

export type StatusPanelViewPayload = {
	showSignSurfaceReady: boolean;
	showPaymentPending: boolean;
	showSignWaiting: boolean;
	showSignUnavailable: boolean;
	message: string[] | null;
	action: PrimaryAction;
	closed: boolean;
	showNdaConfirm: boolean;
};

export type EnrollmentStatusPayload = EnrollmentStatusSnapshot & {
	fingerprint: string;
	poll: boolean;
	hasCheckoutSession: boolean;
	view: StatusPanelViewPayload;
};

export function buildStatusPanelView(
	enrollment: Enrollment,
	ndaSignSurface: SignSurface | null,
): StatusPanelViewPayload {
	const showSignSurface = Boolean(ndaSignSurface);
	const orthogonal = {
		collectionStatus: enrollment.collectionStatus,
		contractStatus: enrollment.contractStatus,
		accessStatus: enrollment.accessStatus,
	};
	const action = primaryAction(orthogonal, ndaSignSurface);
	const message = statusMessage(orthogonal);
	const closed =
		enrollment.accessStatus === 'revoked' || enrollment.collectionStatus === 'refunded';

	return {
		showSignSurfaceReady: showSignSurface,
		showPaymentPending:
			enrollment.collectionStatus === 'pending' && Boolean(enrollment.stripeCheckoutSessionId),
		showSignWaiting:
			isPaidEnough(enrollment.collectionStatus) &&
			enrollment.contractStatus === 'pending' &&
			!showSignSurface,
		showSignUnavailable: enrollment.contractStatus === 'sent' && !showSignSurface,
		message,
		action,
		closed,
		showNdaConfirm:
			enrollment.contractStatus === 'sent' && !closed && ndaSignSurface?.kind === 'redirect',
	};
}

export async function buildEnrollmentStatusPayload(
	enrollment: EnrollmentWithUser,
): Promise<EnrollmentStatusPayload> {
	const resolvedEnrollment = await ensureNdaContractSentIfProvisioned(enrollment);
	enrollment = resolvedEnrollment;

	const orthogonal = {
		collectionStatus: enrollment.collectionStatus,
		contractStatus: enrollment.contractStatus,
		accessStatus: enrollment.accessStatus,
	};

	const ndaSignSurface = await resolveAwaitingNdaSignSurface(enrollment);

	const hasSignSurface = Boolean(ndaSignSurface);
	const signSurfaceKind = ndaSignSurface?.kind ?? null;
	const signSurfaceProvider = ndaSignSurface?.kind === 'embed' ? ndaSignSurface.provider : null;
	const hasCheckoutSession = Boolean(enrollment.stripeCheckoutSessionId);

	return {
		...orthogonal,
		hasSignSurface,
		signSurfaceKind,
		signSurfaceProvider,
		fingerprint: enrollmentFingerprint(orthogonal),
		poll: shouldPollEnrollment({
			...orthogonal,
			hasCheckoutSession,
			hasNdaSignSurface: hasSignSurface,
		}),
		hasCheckoutSession,
		view: buildStatusPanelView(enrollment, ndaSignSurface),
	};
}
