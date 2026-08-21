import { describe, expect, it } from 'vitest';

import { isActionVisible } from './actions';

const sentRedirect = {
	collectionStatus: 'paid' as const,
	contractStatus: 'sent' as const,
	accessStatus: 'not_eligible' as const,
	stripeCheckoutSessionId: 'cs_test',
	ndaRequest: {
		provider: 'yousign' as const,
		externalRequestId: 'req_1',
		externalSignerId: 'sig_1',
		signKind: 'redirect' as const,
	},
};

const sentEmbed = {
	...sentRedirect,
	ndaRequest: {
		provider: 'docuseal' as const,
		externalRequestId: 'req_1',
		externalSignerId: 'sig_1',
		signKind: 'embed' as const,
	},
};

describe('isActionVisible signKind gates', () => {
	it('copy_nda_link visible en redirect', () => {
		expect(isActionVisible('copy_nda_link', sentRedirect)).toBe(true);
	});

	it('copy_nda_link masqué en embed (docuseal)', () => {
		expect(isActionVisible('copy_nda_link', sentEmbed)).toBe(false);
	});

	it('resend_nda visible en redirect', () => {
		expect(
			isActionVisible('resend_nda', {
				...sentRedirect,
				contractStatus: 'sent',
			}),
		).toBe(true);
	});

	it('resend_nda masqué en embed', () => {
		expect(
			isActionVisible('resend_nda', {
				...sentEmbed,
				contractStatus: 'sent',
			}),
		).toBe(false);
	});

	it('docuseal redirect expose copy_nda_link', () => {
		expect(
			isActionVisible('copy_nda_link', {
				...sentRedirect,
				ndaRequest: {
					provider: 'docuseal',
					externalRequestId: 'req_1',
					externalSignerId: 'sig_1',
					signKind: 'redirect',
				},
			}),
		).toBe(true);
	});
});
