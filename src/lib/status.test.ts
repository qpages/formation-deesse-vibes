import { describe, expect, it } from 'vitest';
import { shouldPollEnrollment } from './status';

describe('shouldPollEnrollment', () => {
	it('poll après checkout Stripe en attente de webhook', () => {
		expect(
			shouldPollEnrollment({
				status: 'paiement_en_attente',
				hasCheckoutSession: true,
			}),
		).toBe(true);
	});

	it('ne poll pas le funnel avant checkout', () => {
		expect(
			shouldPollEnrollment({
				status: 'paiement_en_attente',
				hasCheckoutSession: false,
			}),
		).toBe(false);
	});

	it('poll tant que le lien NDA n’est pas prêt', () => {
		expect(
			shouldPollEnrollment({
				status: 'paiement_confirme',
				hasNdaSignUrl: false,
			}),
		).toBe(true);
		expect(
			shouldPollEnrollment({
				status: 'paiement_confirme',
				hasNdaSignUrl: true,
			}),
		).toBe(false);
	});

	it('poll après signature en attendant Teachizy', () => {
		expect(shouldPollEnrollment({ status: 'nda_signe' })).toBe(true);
	});

	it('ne poll pas les états terminaux ou action utilisateur', () => {
		expect(
			shouldPollEnrollment({ status: 'nda_envoye', hasNdaSignUrl: true }),
		).toBe(false);
		expect(shouldPollEnrollment({ status: 'teachizy_envoye' })).toBe(false);
		expect(shouldPollEnrollment({ status: 'rembourse' })).toBe(false);
	});
});
