import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../crypto', () => ({
	decryptPayload: (value: string) => value,
}));

const {
	confirmPaidCheckout,
	ensureNdaAfterPayment,
	markEnrollmentRefunded,
	markSubscriptionScheduleCompleted,
	syncStripeInvoice,
	syncSubscriptionState,
	findEnrollmentById,
	findEnrollmentIdByPaymentIntentId,
} = vi.hoisted(() => ({
	confirmPaidCheckout: vi.fn(),
	ensureNdaAfterPayment: vi.fn(),
	markEnrollmentRefunded: vi.fn(),
	markSubscriptionScheduleCompleted: vi.fn(),
	syncStripeInvoice: vi.fn(),
	syncSubscriptionState: vi.fn(),
	findEnrollmentById: vi.fn(),
	findEnrollmentIdByPaymentIntentId: vi.fn(),
}));

vi.mock('../payments', () => ({
	confirmPaidCheckout,
	ensureNdaAfterPayment,
	markEnrollmentRefunded,
	markSubscriptionScheduleCompleted,
	syncStripeInvoice,
	syncSubscriptionState,
}));

vi.mock('../enrollment', () => ({
	findEnrollmentByCheckoutSession: vi.fn(),
	findEnrollmentById,
	findEnrollmentByScheduleId: vi.fn(),
	findEnrollmentBySubscriptionId: vi.fn(),
	findEnrollmentIdByPaymentIntentId,
	findEnrollmentIdByStripeInvoiceId: vi.fn(),
}));

import { handleStripeProviderEvent, isHandledStripeEventType } from './stripe-events';

function event(type: string, object: Record<string, unknown>) {
	return {
		providerEventId: 'pe_1',
		eventType: type,
		payloadCipherText: JSON.stringify({ id: 'evt_1', type, data: { object } }),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('isHandledStripeEventType', () => {
	it('gère les events refund / dispute', () => {
		expect(isHandledStripeEventType('charge.refunded')).toBe(true);
		expect(isHandledStripeEventType('charge.dispute.created')).toBe(true);
	});
});

describe('handleStripeProviderEvent — invoice.paid', () => {
	it('après sync, enqueue NDA en soft (ensureNdaAfterPayment)', async () => {
		syncStripeInvoice.mockResolvedValue({ ok: true, enrollmentId: 'enr_1' });
		ensureNdaAfterPayment.mockResolvedValue({ status: 'enqueued' });

		const result = await handleStripeProviderEvent(
			event('invoice.paid', {
				object: 'invoice',
				id: 'in_123',
			}),
		);

		expect(syncStripeInvoice).toHaveBeenCalled();
		expect(ensureNdaAfterPayment).toHaveBeenCalledWith('enr_1', 'in_123', { soft: true });
		expect(result).toEqual({ enrollmentId: 'enr_1' });
	});

	it('enrollment introuvable → ignoré, pas d’enqueue NDA', async () => {
		syncStripeInvoice.mockResolvedValue({ ok: false, reason: 'enrollment_not_found' });

		const result = await handleStripeProviderEvent(
			event('invoice.paid', { object: 'invoice', id: 'in_404' }),
		);

		expect(ensureNdaAfterPayment).not.toHaveBeenCalled();
		expect(result).toEqual({ ignored: true });
	});
});

describe('handleStripeProviderEvent — refund / dispute', () => {
	it('charge.refunded total → marque refunded via PaymentIntent', async () => {
		findEnrollmentIdByPaymentIntentId.mockResolvedValue('enr_1');
		markEnrollmentRefunded.mockResolvedValue({ ok: true, enrollmentId: 'enr_1' });

		const result = await handleStripeProviderEvent(
			event('charge.refunded', {
				object: 'charge',
				refunded: true,
				payment_intent: 'pi_123',
				metadata: {},
			}),
		);

		expect(findEnrollmentIdByPaymentIntentId).toHaveBeenCalledWith('pi_123');
		expect(markEnrollmentRefunded).toHaveBeenCalledWith('enr_1', 'refund');
		expect(result).toEqual({ enrollmentId: 'enr_1' });
	});

	it('charge.refunded partiel (refunded=false) → ignoré, pas de révocation', async () => {
		const result = await handleStripeProviderEvent(
			event('charge.refunded', {
				object: 'charge',
				refunded: false,
				amount: 20000,
				amount_refunded: 5000,
				payment_intent: 'pi_123',
			}),
		);

		expect(markEnrollmentRefunded).not.toHaveBeenCalled();
		expect(result).toEqual({ ignored: true });
	});

	it('charge.refunded sans enrollment résoluble → ignoré', async () => {
		findEnrollmentIdByPaymentIntentId.mockResolvedValue(null);

		const result = await handleStripeProviderEvent(
			event('charge.refunded', {
				object: 'charge',
				refunded: true,
				payment_intent: 'pi_unknown',
			}),
		);

		expect(markEnrollmentRefunded).not.toHaveBeenCalled();
		expect(result).toEqual({ ignored: true });
	});

	it('charge.refunded → priorité à metadata.enrollmentId', async () => {
		findEnrollmentById.mockResolvedValue({ id: 'enr_meta' });
		markEnrollmentRefunded.mockResolvedValue({ ok: true, enrollmentId: 'enr_meta' });

		const result = await handleStripeProviderEvent(
			event('charge.refunded', {
				object: 'charge',
				refunded: true,
				payment_intent: 'pi_123',
				metadata: { enrollmentId: 'enr_meta' },
			}),
		);

		expect(findEnrollmentById).toHaveBeenCalledWith('enr_meta');
		expect(findEnrollmentIdByPaymentIntentId).not.toHaveBeenCalled();
		expect(markEnrollmentRefunded).toHaveBeenCalledWith('enr_meta', 'refund');
		expect(result).toEqual({ enrollmentId: 'enr_meta' });
	});

	it('charge.dispute.created → marque refunded (reason dispute)', async () => {
		findEnrollmentIdByPaymentIntentId.mockResolvedValue('enr_2');
		markEnrollmentRefunded.mockResolvedValue({ ok: true, enrollmentId: 'enr_2' });

		const result = await handleStripeProviderEvent(
			event('charge.dispute.created', {
				object: 'dispute',
				payment_intent: 'pi_456',
				metadata: {},
			}),
		);

		expect(markEnrollmentRefunded).toHaveBeenCalledWith('enr_2', 'dispute');
		expect(result).toEqual({ enrollmentId: 'enr_2' });
	});
});
