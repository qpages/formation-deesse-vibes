import { z } from 'zod';

export const checkoutSchema = z.object({
	firstName: z.string().trim().min(1, 'Prénom requis').max(80),
	lastName: z.string().trim().min(1, 'Nom requis').max(80),
	email: z.string().trim().email('E-mail invalide').max(254),
	consentCgv: z.literal(true, { error: 'Acceptation des CGV requise' }),
	consentNda: z.literal(true, { error: 'Acceptation du NDA requise' }),
	consentPrivacy: z.literal(true, {
		error: 'Acceptation de la politique de confidentialité requise',
	}),
});

export const magicLinkSchema = z.object({
	email: z.string().trim().email('E-mail invalide').max(254),
});

export const adminLoginSchema = z.object({
	email: z.string().trim().email(),
	password: z.string().min(8),
});

export const adminActionSchema = z.object({
	enrollmentId: z.string().min(1),
	action: z.enum([
		'relance_nda',
		'recreate_nda',
		'mark_rembourse',
		'mark_acces_retire',
		'retrigger_make',
	]),
});
