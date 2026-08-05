import { purgeOldWebhookPayloads } from '../services/enrollment';
import { createNdaAfterPayment } from './create-nda-after-payment';
import { grantTeachizyAccess } from './grant-teachizy-access';
import { inngest } from './client';
import { processStripeWebhook } from './process-stripe-webhook';
import { processYousignWebhook } from './process-yousign-webhook';
import { reconcileEnrollments } from './reconcile-enrollments';
import { relanceNda } from './relance-nda';
import { suspendTeachizyAccess } from './suspend-teachizy-access';

export { createNdaAfterPayment } from './create-nda-after-payment';
export { grantTeachizyAccess } from './grant-teachizy-access';
export { processStripeWebhook } from './process-stripe-webhook';
export { processYousignWebhook } from './process-yousign-webhook';
export { reconcileEnrollments } from './reconcile-enrollments';
export { relanceNda } from './relance-nda';
export { suspendTeachizyAccess } from './suspend-teachizy-access';

export const purgeWebhookPayloads = inngest.createFunction(
	{
		id: 'purge-webhook-payloads',
		triggers: [{ cron: '0 3 * * *' }],
	},
	async ({ step }) => {
		await step.run('purge', () => purgeOldWebhookPayloads());
		return { ok: true };
	},
);

export const inngestFunctions = [
	processStripeWebhook,
	processYousignWebhook,
	createNdaAfterPayment,
	grantTeachizyAccess,
	relanceNda,
	suspendTeachizyAccess,
	reconcileEnrollments,
	purgeWebhookPayloads,
];
