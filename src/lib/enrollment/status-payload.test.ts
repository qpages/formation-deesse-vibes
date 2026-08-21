import { describe, expect, it } from 'vitest';
import type { Enrollment } from '../../generated/prisma/client';
import {
	buildStatusPanelView,
	enrollmentFingerprint,
	statusUpdateRequiresReload,
	type EnrollmentStatusSnapshot,
} from './status-payload';

const base: EnrollmentStatusSnapshot = {
	collectionStatus: 'complete',
	contractStatus: 'pending',
	accessStatus: 'not_eligible',
	hasSignSurface: false,
	signSurfaceKind: null,
};

describe('enrollmentFingerprint', () => {
	it('concatène les trois enums', () => {
		expect(
			enrollmentFingerprint({
				collectionStatus: 'pending',
				contractStatus: 'sent',
				accessStatus: 'pending',
			}),
		).toBe('pending|sent|pending');
	});
});

describe('buildStatusPanelView', () => {
	it('représente une surface de signature redirect et sa confirmation', () => {
		const enrollment = {
			collectionStatus: 'complete',
			contractStatus: 'sent',
			accessStatus: 'not_eligible',
			stripeCheckoutSessionId: null,
		} as unknown as Enrollment;

		expect(
			buildStatusPanelView(enrollment, {
				kind: 'redirect',
				url: 'https://sign.example.test/nda',
			}),
		).toMatchObject({
			showSignSurfaceReady: true,
			showPaymentPending: false,
			showSignWaiting: false,
			showSignUnavailable: false,
			closed: false,
			showNdaConfirm: true,
		});
	});

	it('représente les états fermés sans rendre la confirmation NDA', () => {
		const enrollment = {
			collectionStatus: 'refunded',
			contractStatus: 'sent',
			accessStatus: 'revoked',
			stripeCheckoutSessionId: 'cs_test_123',
		} as unknown as Enrollment;

		expect(buildStatusPanelView(enrollment, null)).toMatchObject({
			showSignSurfaceReady: false,
			showPaymentPending: false,
			showSignWaiting: false,
			showSignUnavailable: true,
			closed: true,
			showNdaConfirm: false,
		});
	});
});

describe('statusUpdateRequiresReload', () => {
	it('recharge quand le contrat passe de pending à sent (embed SSR)', () => {
		expect(
			statusUpdateRequiresReload(base, {
				...base,
				contractStatus: 'sent',
			}),
		).toBe(true);
	});

	it('recharge quand le contrat passe de pending à sent', () => {
		expect(
			statusUpdateRequiresReload(base, {
				...base,
				contractStatus: 'sent',
			}),
		).toBe(true);
	});

	it('recharge quand la surface de signature apparaît', () => {
		expect(
			statusUpdateRequiresReload(base, {
				...base,
				hasSignSurface: true,
				signSurfaceKind: 'embed',
			}),
		).toBe(true);
	});

	it('recharge quand le contrat est signé', () => {
		expect(
			statusUpdateRequiresReload(
				{ ...base, hasSignSurface: true, signSurfaceKind: 'embed' },
				{
					...base,
					hasSignSurface: true,
					signSurfaceKind: 'embed',
					contractStatus: 'signed',
				},
			),
		).toBe(true);
	});

	it('recharge quand l’accès devient actif', () => {
		expect(
			statusUpdateRequiresReload(
				{ ...base, contractStatus: 'signed', accessStatus: 'pending' },
				{
					...base,
					contractStatus: 'signed',
					accessStatus: 'active',
				},
			),
		).toBe(true);
	});
});
