export type MagicLinkLookup =
	| { status: 'unused'; enrollmentId: string }
	| { status: 'used'; enrollmentId: string }
	| { status: 'invalid' };

export type MagicLinkOutcome =
	| { action: 'set_session'; enrollmentId: string; redirectTo: '/?connected=1' }
	| { action: 'silent_home'; redirectTo: '/' }
	| { action: 'fail'; redirectTo: '/?link=invalid' };

export const MAGIC_LINK_CONNECTED_FLASH = 'Lien magique validé. Voici l’état de votre inscription.';
export const MAGIC_LINK_INVALID_FLASH =
	'Ce lien est invalide ou a expiré. Demandez-en un nouveau ci-dessous.';

/** Décide la redirection PRG après lookup du token (sans I/O). */
export function decideMagicLinkOutcome(
	lookup: MagicLinkLookup,
	cookieEnrollmentId: string | null,
): MagicLinkOutcome {
	if (lookup.status === 'unused') {
		return {
			action: 'set_session',
			enrollmentId: lookup.enrollmentId,
			redirectTo: '/?connected=1',
		};
	}
	if (lookup.status === 'used' && cookieEnrollmentId === lookup.enrollmentId) {
		return { action: 'silent_home', redirectTo: '/' };
	}
	return { action: 'fail', redirectTo: '/?link=invalid' };
}
