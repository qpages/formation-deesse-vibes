# Formation Matrice Évolution

Portail `formation.deesse-vibes.com` — 1 849 € TTC (paiement unique ; majoration en échéances). Accès Teachizy uniquement après paiement + NDA signé (jamais depuis une page succès client).

## Parcours

```
Landing → Stripe Checkout → NDA Yousign → Teachizy (API)
              ↑                              ↓
       même page `/` ← suivi / lien magique Resend
```

1. Formulaire (nom, prénom, e-mail, consentements) → Checkout Stripe
2. Webhook Stripe vérifié → Inngest `createNdaAfterPayment` → demande Yousign
3. Signature NDA → webhook Yousign → Inngest `inviteAfterNdaSigned` → API Teachizy
4. Retour plus tard : e-mail → lien magique Resend → même page

**États :** `Payment.status` (chaque échéance) + sur l’inscription `collectionStatus` / `contractStatus` / `accessStatus`.  
Détail : [`docs/statuts.md`](./statuts.md).  
**Ops Slack :** catalogue des notifs → [`docs/ops-notifications.md`](./ops-notifications.md).

## Stack

Astro 7 SSR (Vercel) · Neon Postgres + Prisma · Stripe · Yousign · Teachizy · Inngest · Resend · Slack  
Admin `/admin` : `ADMIN_EMAIL` / `ADMIN_PASSWORD` + JWT

## Inngest

| Fonction | Event | Rôle |
| --- | --- | --- |
| `createNdaAfterPayment` | `stripe/payment.confirmed` | Crée / active le NDA (5 retries, alerte Slack) |
| `grantTeachizyAccess` | `yousign/signature.done` / `enrollment/access.grant` | Invite Teachizy (5 retries, alerte Slack) |
| `purgeWebhookPayloads` | cron `0 3 * * *` | Efface les payloads chiffrés > 30 j |

Local : `npm run dev` + `npm run inngest:dev` → dashboard http://localhost:8288  
Endpoint : `/api/inngest`

## Webhooks

| Source | Endpoint |
| --- | --- |
| Stripe | `POST /api/webhooks/stripe` |
| Yousign | `POST /api/webhooks/yousign` |
| Inngest | `GET/POST /api/inngest` |

## Consoles

| Outil | URL / notes |
| --- | --- |
| Neon | https://console.neon.tech |
| Stripe | prix `STRIPE_PRICE_UNIQUE` (1 849 €) + X2/X4/X6 |
| Yousign | template NDA côté Yousign (pas dans le repo) |
| Resend | from `formation@deesse-vibes.com` |
| Inngest | https://app.inngest.com |
| Teachizy | https://developer.teachizy.fr/ |
| Vercel | hosting SSR |
| Slack | `SLACK_WEBHOOK_URL` |

Secrets : `.env.example` → `.env` (local) / Vercel (prod).

## Décisions clés

- Page unique pour présentation, achat et suivi
- Doublons e-mail bloqués avant paiement
- Codes promo Stripe activés
- Renvoi NDA : max 1 / 15 min, 5 / jour
- NDA signé stocké chez Yousign (IDs seulement en DB)
- Payloads webhook chiffrés, rétention 30 jours
- Preview ≠ prod (Stripe / Yousign / Teachizy / Neon)

## Avant prod

1. NDA juridique final + template Yousign
2. Produit/prix Stripe live + webhooks
3. Clés Teachizy + UUID formation
4. Domaine Resend, Slack, DNS `formation.deesse-vibes.com`
5. CGV + confidentialité
