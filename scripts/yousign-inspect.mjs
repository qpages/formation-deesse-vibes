#!/usr/bin/env node
/**
 * Diagnostic Yousign (lecture seule) : affiche la réponse brute de l'API pour
 * une demande de signature et son/ses signataire(s). Sert à voir le VRAI motif
 * quand un dossier reste bloqué (statut réel, erreurs, expiration, lien).
 *
 * Usage:
 *   node scripts/yousign-inspect.mjs <requestId>
 *   node scripts/yousign-inspect.mjs --email camille.martin@test.com
 */
import 'dotenv/config';

const apiKey = process.env.YOUSIGN_API_KEY;
const baseUrl = (process.env.YOUSIGN_API_BASE ?? 'https://api.yousign.app/v3').replace(/\/$/, '');

if (!apiKey) {
	console.error('Missing YOUSIGN_API_KEY in .env');
	process.exit(1);
}

async function yousign(path) {
	const res = await fetch(`${baseUrl}${path}`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: 'application/json',
		},
	});
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { status: res.status, ok: res.ok, body };
}

async function resolveRequestId(args) {
	const emailFlag = args.indexOf('--email');
	if (emailFlag !== -1) {
		const email = args[emailFlag + 1];
		if (!email) {
			console.error('--email requires a value');
			process.exit(1);
		}
		const { PrismaClient } = await import('../src/generated/prisma/client/index.js');
		const prisma = new PrismaClient();
		const enrollment = await prisma.enrollment.findFirst({
			where: { user: { email: email.toLowerCase() } },
			orderBy: { createdAt: 'desc' },
			select: { id: true, yousignRequestId: true, yousignSignerId: true },
		});
		await prisma.$disconnect();
		if (!enrollment) {
			console.error(`Aucune inscription pour ${email}`);
			process.exit(1);
		}
		if (!enrollment.yousignRequestId) {
			console.error(`Inscription ${enrollment.id} : aucun yousignRequestId en base.`);
			process.exit(1);
		}
		return enrollment.yousignRequestId;
	}
	const requestId = args.find((a) => !a.startsWith('--'));
	if (!requestId) {
		console.error('Usage: node scripts/yousign-inspect.mjs <requestId> | --email <email>');
		process.exit(1);
	}
	return requestId;
}

const requestId = await resolveRequestId(process.argv.slice(2));

console.log(`\n=== Signature Request ${requestId} ===`);
const request = await yousign(`/signature_requests/${requestId}`);
console.log(`HTTP ${request.status}`);
console.log(JSON.stringify(request.body, null, 2));

if (request.ok && Array.isArray(request.body?.signers)) {
	for (const signer of request.body.signers) {
		console.log(`\n=== Signer ${signer.id} (status brut: ${signer.status}) ===`);
		const detail = await yousign(`/signature_requests/${requestId}/signers/${signer.id}`);
		console.log(`HTTP ${detail.status}`);
		console.log(JSON.stringify(detail.body, null, 2));
	}
}
