import { describe, expect, it, vi } from 'vitest';

const { getEnv } = vi.hoisted(() => ({
	getEnv: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
	yousignProvisionNda: vi.fn(),
	yousignSyncStatus: vi.fn(),
	yousignGetSignSurface: vi.fn(),
	yousignVerify: vi.fn(),
	docusealProvisionNda: vi.fn(),
	docusealSyncStatus: vi.fn(),
	docusealGetSignSurface: vi.fn(),
	docusealVerify: vi.fn(),
}));

vi.mock('../env', () => ({ getEnv }));
vi.mock('./adapters/yousign', () => ({
	yousignAdapter: {
		provisionNda: mocks.yousignProvisionNda,
		syncStatus: mocks.yousignSyncStatus,
		getSignSurface: mocks.yousignGetSignSurface,
		verify: mocks.yousignVerify,
		mapCompletedEvent: vi.fn(),
		downloadSignedPdf: vi.fn(),
	},
}));
vi.mock('./adapters/docuseal', () => ({
	docusealAdapter: {
		provisionNda: mocks.docusealProvisionNda,
		syncStatus: mocks.docusealSyncStatus,
		getSignSurface: mocks.docusealGetSignSurface,
		verify: mocks.docusealVerify,
		mapCompletedEvent: vi.fn(),
		downloadSignedPdf: vi.fn(),
	},
}));

import { docusealAdapter } from './adapters/docuseal';
import { yousignAdapter } from './adapters/yousign';
import {
	resolveDefaultSignatureProvider,
	resolveSignatureProvider,
	resolveSignatureProviderForEnrollment,
} from './providers';

describe('resolveSignatureProvider', () => {
	it('délègue syncStatus au sync adapter YouSign', async () => {
		mocks.yousignSyncStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'signed',
			followUp: { status: 'skipped' },
		});

		const result = await resolveSignatureProvider('yousign').syncStatus('enr_1');

		expect(mocks.yousignSyncStatus).toHaveBeenCalledWith('enr_1');
		expect(result.ok).toBe(true);
	});

	it('délègue syncStatus au sync adapter DocuSeal', async () => {
		mocks.docusealSyncStatus.mockResolvedValue({
			ok: true,
			providerStatus: 'completed',
			followUp: { status: 'skipped' },
		});

		const result = await resolveSignatureProvider('docuseal').syncStatus('enr_2');

		expect(mocks.docusealSyncStatus).toHaveBeenCalledWith('enr_2');
		expect(result.ok).toBe(true);
	});
});

describe('resolveDefaultSignatureProvider', () => {
	it('SIGNATURE_PROVIDER=yousign → yousignAdapter', () => {
		getEnv.mockReturnValue({ SIGNATURE_PROVIDER: 'yousign' });

		expect(resolveDefaultSignatureProvider()).toBe(yousignAdapter);
	});

	it('SIGNATURE_PROVIDER=docuseal → docusealAdapter', () => {
		getEnv.mockReturnValue({ SIGNATURE_PROVIDER: 'docuseal' });

		expect(resolveDefaultSignatureProvider()).toBe(docusealAdapter);
	});
});

describe('resolveSignatureProviderForEnrollment', () => {
	it('utilise le provider persisté sur nda_requests', () => {
		const provider = resolveSignatureProviderForEnrollment({
			ndaRequest: { provider: 'docuseal', externalRequestId: 'r1', externalSignerId: 's1' },
		});

		expect(provider).toBe(docusealAdapter);
	});

	it('défaut yousign sans ndaRequest', () => {
		expect(resolveSignatureProviderForEnrollment({ ndaRequest: null })).toBe(yousignAdapter);
	});
});
