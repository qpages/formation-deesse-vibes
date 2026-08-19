import { describe, expect, it } from 'vitest';

import {
	isNdaFullyProvisioned,
	resolveExternalRequestId,
	resolveExternalSignerId,
	resolveNdaRequestIds,
} from './nda-request';

describe('resolveNdaRequestIds', () => {
	it('prefers nda_requests over enrollment yousign* columns', () => {
		expect(
			resolveNdaRequestIds({
				yousignRequestId: 'legacy_req',
				yousignSignerId: 'legacy_signer',
				ndaRequest: {
					externalRequestId: 'nda_req',
					externalSignerId: 'nda_signer',
				},
			}),
		).toEqual({
			externalRequestId: 'nda_req',
			externalSignerId: 'nda_signer',
		});
	});

	it('falls back to yousign* when ndaRequest is absent', () => {
		expect(
			resolveNdaRequestIds({
				yousignRequestId: 'req_1',
				yousignSignerId: 'signer_1',
			}),
		).toEqual({
			externalRequestId: 'req_1',
			externalSignerId: 'signer_1',
		});
	});

	it('returns null when no ids are stored', () => {
		expect(resolveNdaRequestIds({})).toBeNull();
	});
});

describe('resolveExternalRequestId', () => {
	it('reads from ndaRequest first', () => {
		expect(
			resolveExternalRequestId({
				yousignRequestId: 'old',
				ndaRequest: { externalRequestId: 'new', externalSignerId: null },
			}),
		).toBe('new');
	});
});

describe('resolveExternalSignerId', () => {
	it('reads from ndaRequest first', () => {
		expect(
			resolveExternalSignerId({
				yousignSignerId: 'old',
				ndaRequest: { externalRequestId: 'req', externalSignerId: 'new' },
			}),
		).toBe('new');
	});
});

describe('isNdaFullyProvisioned', () => {
	it('true when ndaRequest has request + signer ids', () => {
		expect(
			isNdaFullyProvisioned({
				ndaRequest: { externalRequestId: 'req', externalSignerId: 'signer' },
			}),
		).toBe(true);
	});

	it('false when only request id is present', () => {
		expect(
			isNdaFullyProvisioned({
				yousignRequestId: 'req',
				yousignSignerId: null,
			}),
		).toBe(false);
	});
});
