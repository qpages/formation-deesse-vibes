import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoicesRetrieve = vi.fn();
const invoicesList = vi.fn();
const paymentIntentsRetrieve = vi.fn();
const sessionsRetrieve = vi.fn();

vi.mock('stripe', () => ({
	default: class {
		invoices = { retrieve: invoicesRetrieve, list: invoicesList };
		paymentIntents = { retrieve: paymentIntentsRetrieve };
		checkout = { sessions: { retrieve: sessionsRetrieve } };
		webhooks = {};
	},
}));

vi.mock('./env', () => ({
	requireEnv: () => 'sk_test_123',
	getEnv: () => ({ STRIPE_SECRET_KEY: 'sk_test_123' }),
}));

vi.mock('./e2e-providers', () => ({ e2eMockProviders: () => false }));

import {
	findInvoiceByPaymentIntent,
	findInvoiceForPaidCheckout,
	paymentIntentIdFromInvoice,
} from './stripe';

const invoice = {
	id: 'in_1',
	object: 'invoice',
	invoice_pdf: 'https://pdf',
	hosted_invoice_url: 'https://hosted',
	payment_intent: 'pi_1',
	metadata: { enrollmentId: 'enr_1' },
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('findInvoiceForPaidCheckout', () => {
	it('utilise session.invoice du payload', async () => {
		invoicesRetrieve.mockResolvedValue(invoice);

		const found = await findInvoiceForPaidCheckout({
			id: 'cs_1',
			invoice: 'in_1',
			payment_intent: 'pi_1',
		} as never);

		expect(invoicesRetrieve).toHaveBeenCalledWith('in_1', { expand: ['payments'] });
		expect(sessionsRetrieve).not.toHaveBeenCalled();
		expect(found).toEqual(invoice);
	});

	it('re-fetch session si invoice absente du payload', async () => {
		sessionsRetrieve.mockResolvedValue({ id: 'cs_1', invoice: 'in_1' });
		invoicesRetrieve.mockResolvedValue(invoice);

		const found = await findInvoiceForPaidCheckout({
			id: 'cs_1',
			invoice: null,
			payment_intent: 'pi_1',
		} as never);

		expect(sessionsRetrieve).toHaveBeenCalledWith('cs_1');
		expect(invoicesRetrieve).toHaveBeenCalledWith('in_1', { expand: ['payments'] });
		expect(found).toEqual(invoice);
	});

	it('retrouve via PaymentIntent.invoice', async () => {
		sessionsRetrieve.mockResolvedValue({ id: 'cs_1', invoice: null });
		paymentIntentsRetrieve.mockResolvedValue({ id: 'pi_1', invoice: 'in_1' });
		invoicesRetrieve.mockResolvedValue(invoice);

		const found = await findInvoiceForPaidCheckout({
			id: 'cs_1',
			invoice: null,
			payment_intent: 'pi_1',
			customer: 'cus_1',
		} as never);

		expect(paymentIntentsRetrieve).toHaveBeenCalledWith('pi_1');
		expect(found).toEqual(invoice);
	});
});

describe('findInvoiceByPaymentIntent', () => {
	it('liste les factures customer si le PI n’a pas invoice', async () => {
		paymentIntentsRetrieve.mockResolvedValue({ id: 'pi_1', invoice: null, customer: 'cus_1' });
		invoicesList.mockResolvedValue({
			data: [{ id: 'in_other', payment_intent: 'pi_other' }, invoice],
		});

		const found = await findInvoiceByPaymentIntent('pi_1');

		expect(invoicesList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 20 });
		expect(found).toEqual(invoice);
	});
});

describe('paymentIntentIdFromInvoice', () => {
	it('lit le champ legacy payment_intent', () => {
		expect(paymentIntentIdFromInvoice(invoice as never)).toBe('pi_1');
	});

	it('lit payments.data pour une invoice d’abonnement', () => {
		const subscriptionInvoice = {
			id: 'in_sub',
			payments: {
				data: [
					{
						is_default: true,
						status: 'paid',
						payment: { type: 'payment_intent', payment_intent: 'pi_sub_1' },
					},
				],
			},
		};
		expect(paymentIntentIdFromInvoice(subscriptionInvoice as never)).toBe('pi_sub_1');
	});
});
