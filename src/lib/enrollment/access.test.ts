import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enrollmentUpdate, sendInngestSafe, findEnrollmentForAccessPolicy } = vi.hoisted(() => ({
	enrollmentUpdate: vi.fn(),
	sendInngestSafe: vi.fn(),
	findEnrollmentForAccessPolicy: vi.fn(),
}));

vi.mock('../prisma', () => ({
	getPrisma: () => ({
		enrollment: { update: enrollmentUpdate },
	}),
}));

vi.mock('../inngest/client', () => ({ sendInngestSafe }));
vi.mock('./queries', () => ({ findEnrollmentForAccessPolicy }));

import { applyAccessPolicy, evaluateAccess } from './access';

function baseEnrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		accessStatus: 'active',
		collectionStatus: 'current',
		contractStatus: 'signed',
		installmentsPaid: 2,
		firstPaymentPaidAt: new Date(),
		user: { email: 'user@example.com', firstName: 'Camille', lastName: 'Martin' },
		payments: [],
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	enrollmentUpdate.mockResolvedValue({});
	sendInngestSafe.mockResolvedValue({ status: 'enqueued' });
});

describe('evaluateAccess', () => {
	it('impayé → OVERDUE_INSTALLMENT', () => {
		expect(
			evaluateAccess({
				firstPaymentPaid: true,
				contractSigned: true,
				hasOverdueInstallment: true,
				orderCanceled: false,
				orderRefunded: false,
			}),
		).toEqual({ shouldHaveAccess: false, reason: 'OVERDUE_INSTALLMENT' });
	});
});

describe('applyAccessPolicy', () => {
	it('active → suspended (past_due) émet suspend', async () => {
		findEnrollmentForAccessPolicy.mockResolvedValue(
			baseEnrollment({ collectionStatus: 'past_due' }),
		);

		const result = await applyAccessPolicy('enr_1');

		expect(result).toMatchObject({
			previous: 'active',
			next: 'suspended',
			emitted: 'suspend',
		});
		expect(sendInngestSafe).toHaveBeenCalledWith({
			name: 'enrollment/access.suspend',
			data: { enrollmentId: 'enr_1', reason: 'OVERDUE_INSTALLMENT' },
		});
	});

	it('suspended → pending (paiement régularisé) émet grant', async () => {
		findEnrollmentForAccessPolicy.mockResolvedValue(
			baseEnrollment({
				accessStatus: 'suspended',
				collectionStatus: 'current',
			}),
		);

		const result = await applyAccessPolicy('enr_1');

		expect(result).toMatchObject({
			previous: 'suspended',
			next: 'pending',
			emitted: 'grant',
		});
		expect(sendInngestSafe).toHaveBeenCalledWith({
			name: 'enrollment/access.grant',
			data: { enrollmentId: 'enr_1' },
		});
	});

	it('active → revoked (remboursement) émet revoke', async () => {
		findEnrollmentForAccessPolicy.mockResolvedValue(
			baseEnrollment({ collectionStatus: 'refunded' }),
		);

		const result = await applyAccessPolicy('enr_1');

		expect(result).toMatchObject({
			previous: 'active',
			next: 'revoked',
			emitted: 'revoke',
		});
		expect(sendInngestSafe).toHaveBeenCalledWith({
			name: 'enrollment/access.revoke',
			data: { enrollmentId: 'enr_1' },
		});
	});

	it('sans changement → pas d’event', async () => {
		findEnrollmentForAccessPolicy.mockResolvedValue(baseEnrollment());

		const result = await applyAccessPolicy('enr_1');

		expect(result.emitted).toBeNull();
		expect(sendInngestSafe).not.toHaveBeenCalled();
	});

	it('active → suspended (contrat manquant) n’émet pas suspend impayé', async () => {
		findEnrollmentForAccessPolicy.mockResolvedValue(baseEnrollment({ contractStatus: 'pending' }));

		const result = await applyAccessPolicy('enr_1');

		expect(result).toMatchObject({
			previous: 'active',
			next: 'suspended',
			emitted: null,
		});
		expect(sendInngestSafe).not.toHaveBeenCalled();
	});
});
