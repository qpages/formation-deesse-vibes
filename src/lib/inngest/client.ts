import { Inngest } from 'inngest';

export const inngest = new Inngest({
	id: 'formation-deesse-vibes',
	name: 'Formation Déesse Vibes',
});

export type AppEvents = {
	'stripe/payment.confirmed': {
		data: { enrollmentId: string; stripeEventId: string };
	};
	'yousign/signature.done': {
		data: { enrollmentId: string; yousignEventId: string; requestId: string };
	};
	'ops/purge-webhook-payloads': {
		data: Record<string, never>;
	};
};
