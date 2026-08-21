import { reconcileEnrollment } from '../enrollment/reconcile';
import { getPrisma } from '../prisma';
import { notifyOps } from '../services/slack';
import { inngest } from './client';

/** Command: ré-applique applyAccessPolicy (cron léger ou admin). */
export const reconcileEnrollments = inngest.createFunction(
	{
		id: 'reconcile-enrollments',
		retries: 2,
		triggers: [{ cron: '0 4 * * *' }, { event: 'ops/reconcile-enrollments' }],
	},
	async ({ event, step }) => {
		const enrollmentId =
			event.name === 'ops/reconcile-enrollments'
				? (event.data as { enrollmentId?: string }).enrollmentId
				: undefined;

		if (enrollmentId) {
			await step.run('reconcile-one', () =>
				reconcileEnrollment(enrollmentId, 'cron.access_policy', 'access_only'),
			);
			return { ok: true, count: 1 };
		}

		const ids = await step.run('find-incoherent', async () => {
			const rows = await getPrisma().enrollment.findMany({
				where: {
					OR: [
						{ accessStatus: 'active', collectionStatus: 'past_due' },
						{ accessStatus: 'suspended', collectionStatus: { in: ['current', 'paid'] } },
						{
							accessStatus: 'not_eligible',
							contractStatus: 'signed',
							collectionStatus: { in: ['current', 'paid'] },
						},
					],
				},
				select: { id: true },
				take: 100,
			});
			return rows.map((r) => r.id);
		});

		for (const id of ids) {
			await step.run(`reconcile-${id}`, () =>
				reconcileEnrollment(id, 'cron.access_policy', 'access_only'),
			);
		}

		if (ids.length > 0) {
			await step.run('notify-reconcile', () =>
				notifyOps({
					kind: 'ops.reconcile_issues',
					severity: 'warn',
					title: 'Reconcile: dossiers incohérents corrigés',
					detail: `count=${ids.length}`,
				}),
			);
		}

		return { ok: true, count: ids.length };
	},
);
