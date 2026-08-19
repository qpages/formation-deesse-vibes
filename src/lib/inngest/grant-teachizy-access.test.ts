import { describe, expect, it } from 'vitest';
import { grantTeachizyAccess } from './grant-teachizy-access';

describe('grantTeachizyAccess', () => {
	it('déclenche sur yousign/signature.done et nda/signature.completed', () => {
		const config = grantTeachizyAccess.opts as {
			triggers: Array<{ event: string }>;
		};

		const events = config.triggers.map((t) => t.event);

		expect(events).toContain('yousign/signature.done');
		expect(events).toContain('nda/signature.completed');
		expect(events).toContain('enrollment/access.grant');
	});
});
