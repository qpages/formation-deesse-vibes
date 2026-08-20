import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadAfterNdaSigned, syncNdaSignature } from './nda-sync';

describe('syncNdaSignature', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('retourne signed:true quand l’API confirme', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ ok: true, signed: true }),
			}),
		);

		await expect(syncNdaSignature()).resolves.toEqual({ signed: true });
		expect(fetch).toHaveBeenCalledWith('/api/enrollment/nda-sync', {
			method: 'POST',
			headers: { Accept: 'application/json' },
			credentials: 'same-origin',
		});
	});

	it('retourne un message d’attente quand pas encore signé', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ ok: true, signed: false }),
			}),
		);

		const result = await syncNdaSignature();
		expect(result).toEqual({
			signed: false,
			message: 'La signature n’est pas encore enregistrée. Réessaie dans quelques secondes.',
		});
	});

	it('utilise le message d’erreur API', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				json: async () => ({ error: 'Session requise.' }),
			}),
		);

		const result = await syncNdaSignature();
		expect(result).toEqual({ signed: false, message: 'Session requise.' });
	});
});

describe('reloadAfterNdaSigned', () => {
	it('positionne le hash acces et recharge', () => {
		const reload = vi.fn();
		const location = { hash: '', reload };
		vi.stubGlobal('window', { location });

		reloadAfterNdaSigned();

		expect(location.hash).toBe('acces');
		expect(reload).toHaveBeenCalled();
	});
});
