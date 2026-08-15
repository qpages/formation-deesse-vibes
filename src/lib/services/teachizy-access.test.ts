import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	enrollmentUpdate,
	getPrisma,
	findEnrollmentById,
	getTeachizyCustomerByEmail,
	inviteToTeachizy,
	isTeachizyConfigured,
} = vi.hoisted(() => {
	const enrollmentUpdate = vi.fn();
	return {
		enrollmentUpdate,
		getPrisma: vi.fn(() => ({ enrollment: { update: enrollmentUpdate } })),
		findEnrollmentById: vi.fn(),
		getTeachizyCustomerByEmail: vi.fn(),
		inviteToTeachizy: vi.fn(),
		isTeachizyConfigured: vi.fn(() => true),
	};
});

vi.mock('../prisma', () => ({ getPrisma }));
vi.mock('./enrollment', () => ({ findEnrollmentById }));
vi.mock('../teachizy', () => ({
	getTeachizyCustomerByEmail,
	inviteToTeachizy,
	isTeachizyConfigured,
}));
vi.mock('../env', () => ({
	getEnv: () => ({ TEACHIZY_TRAINING_UUID: 'training-1' }),
}));

import { inviteOrConfirmTeachizy, syncTeachizyAccess } from './teachizy-access';

function enrollment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'enr_1',
		accessStatus: 'pending',
		contractStatus: 'signed',
		collectionStatus: 'current',
		teachizyInvitedAt: null,
		accessGrantedAt: null,
		user: {
			email: 'quentin@example.com',
			firstName: 'Quentin',
			lastName: 'Pages',
		},
		...overrides,
	};
}

function customer(overrides: Record<string, unknown> = {}) {
	return {
		uuid: 'cust_1',
		email: 'quentin@example.com',
		firstname: 'Quentin',
		lastname: 'Pages',
		status: 'ACTIVE',
		trainings: [
			{
				training: { uuid: 'training-1', name: 'test' },
				enrolled_at: '2026-07-29 10:00:00',
				blocked_at: null,
				progression_percent: 0,
				training_items_count: 4,
				training_items_completed_count: 0,
				total_duration_in_sec: 0,
				quiz_total_percent: -1,
			},
		],
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	isTeachizyConfigured.mockReturnValue(true);
});

describe('syncTeachizyAccess', () => {
	it('enrollment introuvable → ok:false', async () => {
		findEnrollmentById.mockResolvedValue(null);
		const result = await syncTeachizyAccess('missing');
		expect(result).toEqual({ ok: false, reason: 'enrollment_not_found' });
		expect(enrollmentUpdate).not.toHaveBeenCalled();
	});

	it('NDA non signé → not_eligible', async () => {
		findEnrollmentById.mockResolvedValue(enrollment({ contractStatus: 'sent' }));
		const result = await syncTeachizyAccess('enr_1');
		expect(result).toEqual({ ok: false, reason: 'not_eligible' });
	});

	it('déjà active → already_active sans écriture', async () => {
		findEnrollmentById.mockResolvedValue(
			enrollment({
				accessStatus: 'active',
				teachizyInvitedAt: new Date('2026-08-01'),
			}),
		);
		const result = await syncTeachizyAccess('enr_1');
		expect(result).toEqual({ ok: true, outcome: 'already_active' });
		expect(getTeachizyCustomerByEmail).not.toHaveBeenCalled();
		expect(enrollmentUpdate).not.toHaveBeenCalled();
	});

	it('présent sur Teachizy → marked_active', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		getTeachizyCustomerByEmail.mockResolvedValue(customer());

		const result = await syncTeachizyAccess('enr_1');

		expect(result).toEqual({ ok: true, outcome: 'marked_active' });
		expect(enrollmentUpdate).toHaveBeenCalledWith({
			where: { id: 'enr_1' },
			data: expect.objectContaining({
				accessStatus: 'active',
				accessSuspendedAt: null,
			}),
		});
	});

	it('absent Teachizy → not_on_teachizy (pas d’erreur)', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		getTeachizyCustomerByEmail.mockResolvedValue(null);

		const result = await syncTeachizyAccess('enr_1');

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.outcome).toBe('not_on_teachizy');
		expect(enrollmentUpdate).not.toHaveBeenCalled();
	});

	it('formation bloquée → blocked', async () => {
		findEnrollmentById.mockResolvedValue(enrollment());
		getTeachizyCustomerByEmail.mockResolvedValue(
			customer({
				trainings: [
					{
						training: { uuid: 'training-1', name: 'test' },
						enrolled_at: '2026-07-29 10:00:00',
						blocked_at: '2026-08-10 12:00:00',
						progression_percent: 0,
						training_items_count: 4,
						training_items_completed_count: 0,
						total_duration_in_sec: 0,
						quiz_total_percent: -1,
					},
				],
			}),
		);

		const result = await syncTeachizyAccess('enr_1');
		expect(result).toEqual({ ok: false, reason: 'blocked' });
		expect(enrollmentUpdate).not.toHaveBeenCalled();
	});
});

describe('inviteOrConfirmTeachizy', () => {
	const input = {
		enrollmentId: 'enr_1',
		email: 'quentin@example.com',
		firstName: 'Quentin',
		lastName: 'Pages',
	};

	it('invite OK → invited', async () => {
		inviteToTeachizy.mockResolvedValue(undefined);
		const result = await inviteOrConfirmTeachizy(input);
		expect(result).toEqual({ invited: true });
	});

	it('invite échoue mais déjà sur la formation → confirmed', async () => {
		inviteToTeachizy.mockRejectedValue(new Error('Teachizy API error 422: already exists'));
		getTeachizyCustomerByEmail.mockResolvedValue(customer());

		const result = await inviteOrConfirmTeachizy(input);

		expect(result).toEqual({ confirmed: true, source: 'already_present' });
	});

	it('invite échoue et absent → rethrow', async () => {
		inviteToTeachizy.mockRejectedValue(new Error('Teachizy API error 500'));
		getTeachizyCustomerByEmail.mockResolvedValue(null);

		await expect(inviteOrConfirmTeachizy(input)).rejects.toThrow('Teachizy API error 500');
	});
});
