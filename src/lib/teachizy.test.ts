import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({
	getEnv: () => ({
		TEACHIZY_API_KEY: 'key',
		TEACHIZY_API_BASE: 'https://teachizy.test',
		TEACHIZY_TRAINING_UUID: 'training-1',
	}),
	requireEnv: (key: string) => {
		const values: Record<string, string> = {
			TEACHIZY_API_KEY: 'key',
			TEACHIZY_TRAINING_UUID: 'training-1',
		};
		const value = values[key];
		if (!value) throw new Error(`missing ${key}`);
		return value;
	},
}));

import { inviteToTeachizy } from './teachizy';

const input = {
	enrollmentId: 'enr_1',
	email: 'quentin@example.com',
	firstName: 'Quentin',
	lastName: 'Pages',
};

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function customerPayload(overrides: Record<string, unknown> = {}) {
	return {
		data: {
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
		},
	};
}

describe('inviteToTeachizy', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('ne POST pas si le customer a déjà la formation', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(customerPayload()));

		await inviteToTeachizy(input);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
			'/externals/automations/customers?',
		);
	});

	it('POST si le customer n’existe pas', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response('', { status: 404 }))
			.mockResolvedValueOnce(jsonResponse({}, 201));

		await inviteToTeachizy(input);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(vi.mocked(fetch).mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
	});
});
