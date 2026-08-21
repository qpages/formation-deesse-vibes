import { isAwaitingNda } from '../enrollment-gates';
import type { SignSurface } from '../signature/types';
import { resolveNdaSignSurface } from './nda-resend';
import type { EnrollmentWithUser } from './queries';

/**
 * Expose la surface de signature seulement quand l'inscription attend la signature du NDA.
 * Une indisponibilité du provider laisse la page de statut affichable sans surface.
 */
export async function resolveAwaitingNdaSignSurface(
	enrollment: EnrollmentWithUser,
): Promise<SignSurface | null> {
	if (!isAwaitingNda(enrollment)) return null;

	try {
		return await resolveNdaSignSurface(enrollment);
	} catch {
		return null;
	}
}
