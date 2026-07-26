# Outils & flow

Portail `formation.deesse-vibes.com` — Formation Matrice Évolution (320 €).

## Flow (1 minute)

```
Landing → Checkout Stripe → NDA Yousign → Make → Teachizy
                ↑                              ↓
         retour page unique ← suivi / lien magique Resend
```

1. Formulaire (nom, prénom, e-mail, consentements)
2. Paiement Stripe Checkout
3. Webhook Stripe → Inngest → création NDA Yousign
4. Signature NDA → webhook Yousign → Inngest → Make → invitation Teachizy
5. Retour plus tard : e-mail → lien magique Resend → même page `/`

**Règle :** jamais d’accès Teachizy depuis une page succès client — uniquement via webhooks vérifiés.

**États :** `paiement_en_attente` → `paiement_confirme` → `nda_envoye` → `nda_signe` → `invitation_envoyee`

**Admin :** `/admin` (relances NDA / Make, export CSV) — auth via `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## Consoles

| Outil | Rôle | URL |
| --- | --- | --- |
| **Neon** | Postgres | [Console](https://console.neon.tech) — branche dédiée preview/prod |
| **Stripe** | Paiement 320 € | [Dashboard](https://dashboard.stripe.com) — produit `prod_UxHGKAcgiisPWD` · prix `price_1TxMhyL7BRlbDDBVn3MZlfBD` |
| **Yousign** | NDA | [App](https://yousign.app) · API sandbox `https://api-sandbox.yousign.app/v3` |
| **Resend** | E-mails + magic link | [Dashboard](https://resend.com/emails) — from `formation@deesse-vibes.com` |
| **Inngest** | Jobs / retries | [App](https://app.inngest.com) — endpoint `/api/inngest` |
| **Make** | → Teachizy | [Scénarios](https://www.make.com) — webhook `MAKE_WEBHOOK_URL` |
| **Teachizy** | Accès formation | via Make uniquement |
| **Vercel** | Hosting SSR | [Dashboard](https://vercel.com/dashboard) |
| **Slack** | Alertes échecs | Incoming webhook `SLACK_WEBHOOK_URL` |

Secrets : voir `.env.example` → remplir `.env` (local) / Vercel (prod).

---

## Webhooks à brancher (prod)

| Source | Endpoint |
| --- | --- |
| Stripe | `POST /api/webhooks/stripe` |
| Yousign | `POST /api/webhooks/yousign` |
| Inngest | `GET/POST /api/inngest` |

DB déjà migrée en local via `migrate dev` → sur une **autre** Neon : `npm run db:deploy`.
