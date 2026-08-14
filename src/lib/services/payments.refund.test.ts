import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enrollmentUpdate, getPrisma, applyAccessPolicy, notifyOps, findEnrollmentById } =
	vi.hoisted(() => {
		const enrollmentUpdate = vi.fn();
		return {
			enrollmentUpdate,
			getPrisma: vi.fn(() => ({ enrollment: { update: enrollmentUpdate } })),
			applyAccessPolicy: vi.fn(),
			notifyOps: vi.fn(),
			findEnrollmentById: vi.fn(),
		};
	});

vi.mock('../prisma', () => ({ getPrisma }));
vi.mock('./access', () => ({ applyAccessPolicy }));
vi.mock('./slack', () => ({ notifyOps }));
vi.mock('./enrollment', () => ({
	findEnrollmentById,
	findEnrollmentByIdOrThrow: vi.fn(),
	findEnrollmentBySubscriptionId: vi.fn(),
	findEnrollmentByScheduleOrSubscription: vi.fn(),
	attachStripeCheckoutSession: vi.fn(),
}));

// Modules lourds / à effets : neutralisés pour un import propre.
vi.mock('../inngest/client', () => ({ inngest: {}, sendInngestSafe: vi.fn() }));
vi.mock('../stripe', () => ({
	createCheckoutSession: vi.fn(),
	ensureSubscriptionSchedule: vi.fn(),
	expireCheckoutSession: vi.fn(),
	getStripe: vi.fn(),
	listSubscriptionInvoices: vi.fn(),
	retrieveCheckoutSession: vi.fn(),
	retrieveSubscription: vi.fn(),
}));

import { markEnrollmentRefunded } from './payments';

function enrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		collectionStatus: 'current',
		user: { email: 'eleve@example.com' },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('markEnrollmentRefunded', () => {
	it('enrollment introuvable → ok:false, aucune écriture', async () => {
		findEnrollmentById.mockResolvedValue(null);

		const result = await markEnrollmentRefunded('missing', 'refund');

		expect(result).toEqual({ ok: false, reason: 'enrollment_not_found' });
		expect(enrollmentUpdate).not.toHaveBeenCalled();
		expect(applyAccessPolicy).not.toHaveBeenCalled();
	});

	it('refund → collectionStatus refunded + notif + révocation accès', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ collectionStatus: 'current' }));

		const result = await markEnrollmentRefunded('enr_1', 'refund');

		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: { collectionStatus: 'refunded' },
		});
		expect(notifyOps).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'collection.refunded', severity: 'warn' }),
		);
		expect(applyAccessPolicy).toHaveBeenCalledWith('enr_1');
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});

	it('dispute → severity critical', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ collectionStatus: 'paid' }));

		await markEnrollmentRefunded('enr_1', 'dispute');

		expect(notifyOps).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'collection.refunded', severity: 'critical' }),
		);
		expect(applyAccessPolicy).toHaveBeenCalledWith('enr_1');
	});

	it('déjà refunded → idempotent : pas de re-notif, mais révocation rejouée', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ collectionStatus: 'refunded' }));

		const result = await markEnrollmentRefunded('enr_1', 'refund');

		expect(enrollmentUpdate).not.toHaveBeenCalled();
		expect(notifyOps).not.toHaveBeenCalled();
		expect(applyAccessPolicy).toHaveBeenCalledWith('enr_1');
		expect(result).toEqual({ ok: true, enrollmentId: 'enr_1' });
	});
});
