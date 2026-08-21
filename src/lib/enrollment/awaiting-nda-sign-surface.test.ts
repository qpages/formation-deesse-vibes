import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrollmentWithUser } from './queries';

const { resolveNdaSignSurface } = vi.hoisted(() => ({
	resolveNdaSignSurface: vi.fn(),
}));

vi.mock('./nda-resend', () => ({ resolveNdaSignSurface }));

import { resolveAwaitingNdaSignSurface } from './awaiting-nda-sign-surface';

const awaitingEnrollment = {
	collectionStatus: 'complete',
	contractStatus: 'sent',
	accessStatus: 'not_eligible',
} as unknown as EnrollmentWithUser;

describe('resolveAwaitingNdaSignSurface', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('ne résout pas de surface quand le NDA n’est plus en attente', async () => {
		const result = await resolveAwaitingNdaSignSurface({
			...awaitingEnrollment,
			contractStatus: 'signed',
		});

		expect(result).toBeNull();
		expect(resolveNdaSignSurface).not.toHaveBeenCalled();
	});

	it('retourne la surface pour un NDA en attente', async () => {
		const surface = { kind: 'redirect' as const, url: 'https://sign.example.test/nda' };
		resolveNdaSignSurface.mockResolvedValue(surface);

		await expect(resolveAwaitingNdaSignSurface(awaitingEnrollment)).resolves.toEqual(surface);
		expect(resolveNdaSignSurface).toHaveBeenCalledWith(awaitingEnrollment);
	});

	it('masque une erreur de résolution pour laisser le statut affichable', async () => {
		resolveNdaSignSurface.mockRejectedValue(new Error('Provider unavailable'));

		await expect(resolveAwaitingNdaSignSurface(awaitingEnrollment)).resolves.toBeNull();
	});
});
