import { describe, expect, it } from 'vitest';

import {
	isNdaFullyProvisioned,
	resolveExternalRequestId,
	resolveExternalSignerId,
	resolveNdaRequestIds,
	resolveSignKind,
} from './nda-request';

describe('resolveSignKind', () => {
	it('lit signKind depuis ndaRequest', () => {
		expect(resolveSignKind({ ndaRequest: { signKind: 'embed' } })).toBe('embed');
		expect(resolveSignKind({ ndaRequest: { signKind: 'redirect' } })).toBe('redirect');
	});

	it('défaut redirect si absent', () => {
		expect(resolveSignKind({})).toBe('redirect');
		expect(resolveSignKind({ ndaRequest: null })).toBe('redirect');
	});
});

describe('resolveNdaRequestIds', () => {
	it('reads from nda_requests', () => {
		expect(
			resolveNdaRequestIds({
				ndaRequest: {
					provider: 'yousign',
					externalRequestId: 'nda_req',
					externalSignerId: 'nda_signer',
				},
			}),
		).toEqual({
			externalRequestId: 'nda_req',
			externalSignerId: 'nda_signer',
		});
	});

	it('returns null when ndaRequest is absent', () => {
		expect(resolveNdaRequestIds({})).toBeNull();
	});
});

describe('resolveExternalRequestId', () => {
	it('reads from ndaRequest', () => {
		expect(
			resolveExternalRequestId({
				ndaRequest: { externalRequestId: 'new', externalSignerId: null, provider: 'yousign' },
			}),
		).toBe('new');
	});
});

describe('resolveExternalSignerId', () => {
	it('reads from ndaRequest', () => {
		expect(
			resolveExternalSignerId({
				ndaRequest: { externalRequestId: 'req', externalSignerId: 'new', provider: 'yousign' },
			}),
		).toBe('new');
	});
});

describe('isNdaFullyProvisioned', () => {
	it('true when ndaRequest has request + signer ids', () => {
		expect(
			isNdaFullyProvisioned({
				ndaRequest: { externalRequestId: 'req', externalSignerId: 'signer', provider: 'yousign' },
			}),
		).toBe(true);
	});

	it('false when only request id is present', () => {
		expect(
			isNdaFullyProvisioned({
				ndaRequest: { externalRequestId: 'req', externalSignerId: null, provider: 'yousign' },
			}),
		).toBe(false);
	});
});
