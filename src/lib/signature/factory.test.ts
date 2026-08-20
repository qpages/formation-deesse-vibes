import { describe, expect, it, vi } from 'vitest';

const { getEnv } = vi.hoisted(() => ({
	getEnv: vi.fn(),
}));

vi.mock('../env', () => ({ getEnv }));
vi.mock('./adapters/yousign', () => ({
	yousignAdapter: { provider: 'yousign' },
}));
vi.mock('./adapters/docuseal', () => ({
	docusealAdapter: { provider: 'docuseal' },
}));

import { docusealAdapter } from './adapters/docuseal';
import { yousignAdapter } from './adapters/yousign';
import { getSignatureOps, getSignaturePort, getSignatureWebhookAdapter } from './factory';

describe('signature factory', () => {
	it('SIGNATURE_PROVIDER=yousign → yousignAdapter', () => {
		getEnv.mockReturnValue({ SIGNATURE_PROVIDER: 'yousign' });

		expect(getSignaturePort()).toBe(yousignAdapter);
		expect(getSignatureWebhookAdapter()).toBe(yousignAdapter);
		expect(getSignatureOps('yousign')).toBe(yousignAdapter);
	});

	it('SIGNATURE_PROVIDER=docuseal → docusealAdapter', () => {
		getEnv.mockReturnValue({ SIGNATURE_PROVIDER: 'docuseal' });

		expect(getSignaturePort()).toBe(docusealAdapter);
		expect(getSignatureWebhookAdapter()).toBe(docusealAdapter);
		expect(getSignatureOps('docuseal')).toBe(docusealAdapter);
	});
});
