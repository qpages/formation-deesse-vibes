import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileEnrollment } = vi.hoisted(() => ({
	reconcileEnrollment: vi.fn(),
}));

vi.mock('../enrollment/reconcile', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../enrollment/reconcile')>();
	return { ...actual, reconcileEnrollment };
});
vi.mock('../enrollment', () => ({
	canResendNda: vi.fn(),
	findEnrollmentById: vi.fn(),
}));
vi.mock('../services/teachizy-access', () => ({ syncTeachizyAccess: vi.fn() }));
vi.mock('../services/slack', () => ({ notifyOps: vi.fn() }));
vi.mock('../inngest/client', () => ({ sendInngestSafe: vi.fn() }));
vi.mock('../signature/providers', () => ({ resolveSignatureProviderForEnrollment: vi.fn() }));

import { resolveSignatureProviderForEnrollment } from '../signature/providers';
import { dispatchAdminAction } from './dispatch';

const enrollment = { id: 'enr_1' } as Parameters<typeof dispatchAdminAction>[1];

beforeEach(() => {
	vi.clearAllMocks();
});

describe('dispatchAdminAction sync NDA', () => {
	it('sync_nda appelle reconcileEnrollment nda_signature', async () => {
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'admin.sync_nda',
			scope: 'nda_signature',
			steps: [{ step: 'nda_signature', status: 'ok', signed: false }],
			mutated: false,
		});

		const result = await dispatchAdminAction('sync_nda', enrollment);

		expect(reconcileEnrollment).toHaveBeenCalledWith('enr_1', 'admin.sync_nda', 'nda_signature');
		expect(result).toEqual({ ok: true });
	});

	it('not_awaiting skipped → erreur admin', async () => {
		reconcileEnrollment.mockResolvedValue({
			enrollmentId: 'enr_1',
			trigger: 'admin.sync_nda',
			scope: 'nda_signature',
			steps: [{ step: 'nda_signature', status: 'skipped', reason: 'not_awaiting' }],
			mutated: false,
		});

		const result = await dispatchAdminAction('sync_nda', enrollment);

		expect(result).toEqual({
			ok: false,
			error: 'Le contrat n’est pas en attente de signature.',
			status: 400,
		});
	});
});

describe('dispatchAdminAction copy_nda_link', () => {
	it('refuse embed', async () => {
		const result = await dispatchAdminAction('copy_nda_link', {
			...enrollment,
			ndaRequest: {
				provider: 'docuseal',
				externalRequestId: 'req_1',
				externalSignerId: 'sig_1',
				signKind: 'embed',
			},
		} as Parameters<typeof dispatchAdminAction>[1]);

		expect(result).toEqual({
			ok: false,
			error: 'Signature intégrée (embed) — pas de lien à copier.',
			status: 400,
		});
	});

	it('copie le lien redirect', async () => {
		vi.mocked(resolveSignatureProviderForEnrollment).mockReturnValue({
			getSignSurface: vi.fn().mockResolvedValue({
				kind: 'redirect',
				url: 'https://sign.example',
			}),
		} as unknown as ReturnType<typeof resolveSignatureProviderForEnrollment>);

		const result = await dispatchAdminAction('copy_nda_link', {
			...enrollment,
			ndaRequest: {
				provider: 'yousign',
				externalRequestId: 'req_1',
				externalSignerId: 'sig_1',
				signKind: 'redirect',
			},
		} as Parameters<typeof dispatchAdminAction>[1]);

		expect(result).toEqual({
			ok: true,
			message: 'Lien copié dans le presse-papiers.',
			copyUrl: 'https://sign.example',
		});
	});
});
