import { describe, expect, it } from 'vitest';
import { shouldPollEnrollment } from './steps';

const base = {
	collectionStatus: 'current' as const,
	contractStatus: 'pending' as const,
	accessStatus: 'not_eligible' as const,
};

describe('shouldPollEnrollment', () => {
	it('poll si checkout en cours', () => {
		expect(
			shouldPollEnrollment({
				collectionStatus: 'pending',
				contractStatus: 'pending',
				accessStatus: 'not_eligible',
				hasCheckoutSession: true,
			}),
		).toBe(true);
	});

	it('poll si NDA envoyé (lien prêt)', () => {
		expect(
			shouldPollEnrollment({
				...base,
				collectionStatus: 'paid',
				contractStatus: 'sent',
				hasNdaSignSurface: true,
			}),
		).toBe(true);
	});

	it('poll si NDA pending sans lien', () => {
		expect(
			shouldPollEnrollment({
				...base,
				collectionStatus: 'paid',
				contractStatus: 'pending',
				hasNdaSignSurface: false,
			}),
		).toBe(true);
	});

	it('poll si accès pending (invite Teachizy)', () => {
		expect(
			shouldPollEnrollment({
				collectionStatus: 'paid',
				contractStatus: 'signed',
				accessStatus: 'pending',
			}),
		).toBe(true);
	});

	it('ne poll pas une fois l’accès actif', () => {
		expect(
			shouldPollEnrollment({
				collectionStatus: 'paid',
				contractStatus: 'signed',
				accessStatus: 'active',
				hasNdaSignSurface: true,
			}),
		).toBe(false);
	});
});
