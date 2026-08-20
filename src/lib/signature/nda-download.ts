import { findEnrollmentById } from '../enrollment/queries';
import { json } from '../http';
import { resolveExternalRequestId } from './nda-request';
import { resolveSignatureProviderForEnrollment } from './providers';

export type SignedNdaFailureReason =
	'enrollment_not_found' | 'not_signed' | 'no_nda_request' | 'provider_error';

export type SignedNdaResult =
	| { ok: true; bytes: Uint8Array; contentType: string; filename: string }
	| { ok: false; reason: SignedNdaFailureReason; detail?: string };

const ERROR_STATUS: Record<SignedNdaFailureReason, { status: number; message: string }> = {
	enrollment_not_found: { status: 404, message: 'Inscription introuvable.' },
	not_signed: { status: 409, message: 'Le contrat n’est pas encore signé.' },
	no_nda_request: {
		status: 400,
		message: 'Aucune demande de signature associée. Contactez un administrateur.',
	},
	provider_error: {
		status: 502,
		message:
			'Impossible de télécharger le contrat pour le moment. Réessayez dans quelques secondes.',
	},
};

function filenameFor(contentType: string): string {
	const ext = contentType.includes('zip') ? 'zip' : 'pdf';
	return `contrat-confidentialite.${ext}`;
}

/** Fetch live chez le provider — le PDF n’est pas persisté. */
export async function getSignedNdaPdf(enrollmentId: string): Promise<SignedNdaResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	if (enrollment.contractStatus !== 'signed') {
		return { ok: false, reason: 'not_signed' };
	}
	const requestId = resolveExternalRequestId(enrollment);
	if (!requestId) {
		return { ok: false, reason: 'no_nda_request' };
	}

	try {
		const file = await resolveSignatureProviderForEnrollment(enrollment).downloadSignedPdf(
			requestId,
		);
		return {
			ok: true,
			bytes: file.bytes,
			contentType: file.contentType,
			filename: filenameFor(file.contentType),
		};
	} catch (error) {
		return {
			ok: false,
			reason: 'provider_error',
			detail: error instanceof Error ? error.message : 'unknown',
		};
	}
}

export function toSignedNdaResponse(result: SignedNdaResult): Response {
	if (!result.ok) {
		const mapped = ERROR_STATUS[result.reason];
		return json({ error: mapped.message, reason: result.reason }, mapped.status, {
			'Cache-Control': 'no-store',
		});
	}

	return new Response(Buffer.from(result.bytes), {
		status: 200,
		headers: {
			'Content-Type': result.contentType,
			'Content-Disposition': `attachment; filename="${result.filename}"`,
			'Cache-Control': 'private, no-store',
		},
	});
}
