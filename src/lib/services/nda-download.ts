import { json } from '../http';
import { getSignaturePort } from '../signature/factory';
import { findEnrollmentById } from './enrollment';

export type SignedNdaFailureReason =
	'enrollment_not_found' | 'not_signed' | 'no_yousign_request' | 'yousign_error';

export type SignedNdaResult =
	| { ok: true; bytes: Uint8Array; contentType: string; filename: string }
	| { ok: false; reason: SignedNdaFailureReason; detail?: string };

const ERROR_STATUS: Record<SignedNdaFailureReason, { status: number; message: string }> = {
	enrollment_not_found: { status: 404, message: 'Inscription introuvable.' },
	not_signed: { status: 409, message: 'Le contrat n’est pas encore signé.' },
	no_yousign_request: {
		status: 400,
		message: 'Aucune demande de signature associée. Contactez un administrateur.',
	},
	yousign_error: {
		status: 502,
		message:
			'Impossible de télécharger le contrat pour le moment. Réessayez dans quelques secondes.',
	},
};

function filenameFor(contentType: string): string {
	const ext = contentType.includes('zip') ? 'zip' : 'pdf';
	return `contrat-confidentialite.${ext}`;
}

/** Fetch live chez Yousign — le PDF n’est pas persisté. */
export async function getSignedNdaPdf(enrollmentId: string): Promise<SignedNdaResult> {
	const enrollment = await findEnrollmentById(enrollmentId);
	if (!enrollment) {
		return { ok: false, reason: 'enrollment_not_found' };
	}
	if (enrollment.contractStatus !== 'signed') {
		return { ok: false, reason: 'not_signed' };
	}
	if (!enrollment.yousignRequestId) {
		return { ok: false, reason: 'no_yousign_request' };
	}

	try {
		const file = await getSignaturePort().downloadSignedPdf(enrollment.yousignRequestId);
		return {
			ok: true,
			bytes: file.bytes,
			contentType: file.contentType,
			filename: filenameFor(file.contentType),
		};
	} catch (error) {
		return {
			ok: false,
			reason: 'yousign_error',
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

	return new Response(result.bytes, {
		status: 200,
		headers: {
			'Content-Type': result.contentType,
			'Content-Disposition': `attachment; filename="${result.filename}"`,
			'Cache-Control': 'private, no-store',
		},
	});
}
