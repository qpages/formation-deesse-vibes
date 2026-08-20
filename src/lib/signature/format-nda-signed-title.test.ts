import { describe, expect, it } from 'vitest';

import { formatNdaSignedTitle } from './format-nda-signed-title';

describe('formatNdaSignedTitle', () => {
	it('formats buyer name and Paris-localized timestamp', () => {
		const at = new Date('2026-01-15T14:30:00.000Z');
		expect(formatNdaSignedTitle('Marie', 'Dupont', at)).toMatch(
			/^Marie Dupont a signé le contrat de confidentialité le /,
		);
	});

	it('falls back when name is blank', () => {
		expect(formatNdaSignedTitle(' ', '', new Date('2026-01-15T14:30:00.000Z'))).toMatch(
			/^Un acheteur a signé le contrat de confidentialité le /,
		);
	});
});
