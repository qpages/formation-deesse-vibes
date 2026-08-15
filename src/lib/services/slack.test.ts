import { afterEach, describe, expect, it } from 'vitest';
import { resetOpsAlertDedupeForTests, shouldSendOpsAlert, type OpsNotifyInput } from './slack';

afterEach(() => {
	resetOpsAlertDedupeForTests();
});

const login = (email: string): OpsNotifyInput => ({
	kind: 'admin.login',
	severity: 'info',
	title: 'Connexion admin',
	email,
});

describe('shouldSendOpsAlert', () => {
	it('laisse passer paiement / jobs (pas de dédup)', () => {
		const paid: OpsNotifyInput = {
			kind: 'payment.first_confirmed',
			severity: 'info',
			title: 'Payé',
			enrollmentId: 'enr_1',
		};
		expect(shouldSendOpsAlert(paid, 1000)).toBe(true);
		expect(shouldSendOpsAlert(paid, 1001)).toBe(true);
	});

	it('déduplique admin.login par e-mail pendant 2 min', () => {
		expect(shouldSendOpsAlert(login('a@b.c'), 0)).toBe(true);
		expect(shouldSendOpsAlert(login('a@b.c'), 60_000)).toBe(false);
		expect(shouldSendOpsAlert(login('a@b.c'), 120_000)).toBe(true);
		expect(shouldSendOpsAlert(login('other@b.c'), 60_000)).toBe(true);
	});
});
