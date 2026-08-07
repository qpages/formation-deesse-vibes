import { requireEnv } from './env';

interface TeachizyInviteInput {
	enrollmentId: string;
	email: string;
	firstName: string;
	lastName: string;
}

/**
 * Invite un apprenant directement sur Teachizy via leur API REST.
 * @see https://developer.teachizy.fr/
 */
export async function inviteToTeachizy(input: TeachizyInviteInput): Promise<void> {
	const apiKey = requireEnv('TEACHIZY_API_KEY');
	const baseUrl = requireEnv('TEACHIZY_API_BASE');
	const trainingUuid = requireEnv('TEACHIZY_TRAINING_UUID');

	console.log('[Teachizy] Sending invitation', {
		enrollmentId: input.enrollmentId,
		email: input.email,
		firstName: input.firstName,
		lastName: input.lastName,
		trainingUuid,
	});

	const response = await fetch(`${baseUrl}/externals/automations/customers`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			firstname: input.firstName,
			lastname: input.lastName,
			email: input.email,
			training_uuids: [trainingUuid],
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		console.error('[Teachizy] API error', {
			status: response.status,
			body,
			enrollmentId: input.enrollmentId,
		});
		throw new Error(`Teachizy API error ${response.status}: ${body}`, {
			cause: { enrollmentId: input.enrollmentId },
		});
	}

	console.log('[Teachizy] Invitation sent successfully', {
		enrollmentId: input.enrollmentId,
		status: response.status,
	});
}
