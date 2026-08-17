import { describe, expect, it } from 'vitest';
import { decideMagicLinkOutcome } from './magic-link-outcome';

describe('decideMagicLinkOutcome', () => {
	it('token unused → session cookie + redirect connected=1', () => {
		expect(decideMagicLinkOutcome({ status: 'unused', enrollmentId: 'enr_1' }, null)).toEqual({
			action: 'set_session',
			enrollmentId: 'enr_1',
			redirectTo: '/?connected=1#acces',
		});
	});

	it('token used + même enrollment cookie → accueil silencieux', () => {
		expect(decideMagicLinkOutcome({ status: 'used', enrollmentId: 'enr_1' }, 'enr_1')).toEqual({
			action: 'silent_home',
			redirectTo: '/#acces',
		});
	});

	it('token used + autre cookie → échec', () => {
		expect(decideMagicLinkOutcome({ status: 'used', enrollmentId: 'enr_1' }, 'enr_other')).toEqual({
			action: 'fail',
			redirectTo: '/?link=invalid#acces',
		});
	});

	it('token used sans cookie → échec', () => {
		expect(decideMagicLinkOutcome({ status: 'used', enrollmentId: 'enr_1' }, null)).toEqual({
			action: 'fail',
			redirectTo: '/?link=invalid#acces',
		});
	});

	it('token inconnu ou expiré → échec', () => {
		expect(decideMagicLinkOutcome({ status: 'invalid' }, 'enr_1')).toEqual({
			action: 'fail',
			redirectTo: '/?link=invalid#acces',
		});
	});
});
