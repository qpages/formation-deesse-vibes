import { describe, expect, it } from 'vitest';

import {
	assertValidProviderModeCombo,
	defaultSignatureMode,
	resolveSignatureConfig,
	resolveSignKind,
} from './config';

describe('resolveSignatureConfig', () => {
	it('defaults docuseal → embed', () => {
		expect(resolveSignatureConfig({ SIGNATURE_PROVIDER: 'docuseal' })).toEqual({
			provider: 'docuseal',
			mode: 'embed',
			signKind: 'embed',
		});
	});

	it('defaults yousign → redirect', () => {
		expect(resolveSignatureConfig({ SIGNATURE_PROVIDER: 'yousign' })).toEqual({
			provider: 'yousign',
			mode: 'redirect',
			signKind: 'redirect',
		});
	});

	it('honours explicit SIGNATURE_MODE=redirect with docuseal', () => {
		expect(
			resolveSignatureConfig({ SIGNATURE_PROVIDER: 'docuseal', SIGNATURE_MODE: 'redirect' }),
		).toEqual({
			provider: 'docuseal',
			mode: 'redirect',
			signKind: 'redirect',
		});
	});

	it('honours explicit SIGNATURE_MODE=embed with docuseal', () => {
		expect(
			resolveSignatureConfig({ SIGNATURE_PROVIDER: 'docuseal', SIGNATURE_MODE: 'embed' }),
		).toEqual({
			provider: 'docuseal',
			mode: 'embed',
			signKind: 'embed',
		});
	});
});

describe('assertValidProviderModeCombo', () => {
	it('allows docuseal + embed', () => {
		expect(() => assertValidProviderModeCombo('docuseal', 'embed')).not.toThrow();
	});

	it('allows docuseal + redirect', () => {
		expect(() => assertValidProviderModeCombo('docuseal', 'redirect')).not.toThrow();
	});

	it('allows yousign + redirect', () => {
		expect(() => assertValidProviderModeCombo('yousign', 'redirect')).not.toThrow();
	});

	it('rejects yousign + embed', () => {
		expect(() => assertValidProviderModeCombo('yousign', 'embed')).toThrow(/embed.*yousign/i);
	});
});

describe('resolveSignKind', () => {
	it('maps mode to signKind', () => {
		expect(resolveSignKind('embed')).toBe('embed');
		expect(resolveSignKind('redirect')).toBe('redirect');
	});
});

describe('defaultSignatureMode', () => {
	it('returns provider defaults', () => {
		expect(defaultSignatureMode('docuseal')).toBe('embed');
		expect(defaultSignatureMode('yousign')).toBe('redirect');
	});
});
