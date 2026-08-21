import { describe, expect, it } from 'vitest';
import { mapSignatureRequestPhase } from './status-phase';

describe('mapSignatureRequestPhase', () => {
	it.each([
		['yousign', 'ongoing', 'awaiting_signature'],
		['yousign', 'done', 'signed'],
		['yousign', 'rejected', 'declined'],
		['docuseal', 'awaiting', 'awaiting_signature'],
		['docuseal', 'completed', 'signed'],
		['docuseal', 'cancelled', 'canceled'],
		['docuseal', 'failed', 'failed'],
	] as const)('%s %s → %s', (provider, status, phase) => {
		expect(mapSignatureRequestPhase(provider, status)).toBe(phase);
	});

	it('leaves unknown provider vocabulary unmapped', () => {
		expect(mapSignatureRequestPhase('docuseal', 'custom-state')).toBeNull();
	});
});
