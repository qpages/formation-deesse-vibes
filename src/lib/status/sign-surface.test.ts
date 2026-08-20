import { describe, expect, it } from 'vitest';
import type { SignSurface } from '../signature/types';
import { primaryAction } from './steps';

describe('primaryAction SignSurface mapping', () => {
	const awaitingNda = {
		collectionStatus: 'paid' as const,
		contractStatus: 'sent' as const,
		accessStatus: 'not_eligible' as const,
	};

	it('redirect → sign_nda avec href', () => {
		const surface: SignSurface = { kind: 'redirect', url: 'https://sign.example' };
		expect(primaryAction(awaitingNda, surface)).toEqual({
			kind: 'sign_nda',
			label: 'Signer mon accord',
			href: 'https://sign.example',
		});
	});

	it('embed → refresh (formulaire inline)', () => {
		const surface: SignSurface = {
			kind: 'embed',
			src: 'https://docuseal.eu/s/abc',
			email: 'a@b.c',
		};
		expect(primaryAction(awaitingNda, surface)).toEqual({
			kind: 'refresh',
			label: 'Actualiser',
		});
	});
});
