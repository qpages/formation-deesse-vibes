import { describe, expect, it } from 'vitest';
import { grantTeachizyAccess } from './grant-teachizy-access';

describe('grantTeachizyAccess', () => {
	it('déclenche sur nda/signature.completed et enrollment/access.grant', () => {
		const config = grantTeachizyAccess.opts as {
			triggers: Array<{ event: string }>;
		};

		const events = config.triggers.map((t) => t.event);

		expect(events).toContain('nda/signature.completed');
		expect(events).toContain('enrollment/access.grant');
		expect(events).not.toContain('yousign/signature.done');
	});
});
