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
3. Signature NDA → webhook Yousign → Inngest `grantTeachizyAccess` → API Teachizy
4. Retour plus tard : e-mail → lien magique Resend → même page

```
Checkout ouvert
  → 1er paiement OK
  → NDA envoyé → NDA signé
  → création accès Teachizy
  → accès OK
  → (éventuellement) échéances suivantes jusqu’à solde
```

## Statuts d’une inscription

Quatre notions à ne pas confondre :

| Champ | Où | Question |
| --- | --- | --- |
| `Payment.status` | chaque échéance | Cette facture est-elle payée ? |
| `collectionStatus` | l’inscription | L’élève est-il à jour sur l’ensemble ? |
| `contractStatus` | l’inscription | Où en est le NDA ? |
| `accessStatus` | l’inscription | A-t-il accès à Teachizy ? |

`Payment.status` = une ligne. `collectionStatus` = le résumé de toutes les lignes.

### `Payment.status`

| Valeur | En clair |
| --- | --- |
| `draft` | Pas encore exigible |
| `open` | À payer |
| `paid` | Payé |
| `failed` | Échec de paiement |
| `void` | Annulé |
| `uncollectible` | On ne récupère plus |

Exemple plan ×4 : 4 lignes Payment, chacune avec son `status`.

### `collectionStatus`

| Valeur | En clair |
| --- | --- |
| `pending` | Rien encaissé |
| `current` | À jour, d’autres échéances à venir |
| `past_due` | Au moins une échéance en retard |
| `paid` | Tout est payé |
| `canceled` | Commande annulée |
| `refunded` | Remboursé |

### `contractStatus`

| Valeur | En clair |
| --- | --- |
| `pending` | Pas encore envoyé |
| `sent` | Envoyé, en attente de signature |
| `signed` | Signé |
| `expired` | Expiré |
| `declined` | Refusé |
| `canceled` | Annulé |
| `error` | Échec technique |

Miroir provider Yousign : `yousignStatus` (`ongoing`, `done`…). Référence métier = `contractStatus`.

### `accessStatus`

| Valeur | En clair |
| --- | --- |
| `not_eligible` | Conditions pas remplies |
| `pending` | Conditions OK → création accès |
| `active` | Accès ouvert |
| `suspended` | Coupé temporairement (souvent impayé) |
| `revoked` | Retiré pour de bon |

Conditions pour sortir de `not_eligible` : 1er paiement OK + NDA signé + pas d’impayé bloquant + pas annulé/remboursé.

### Exemples

| Situation | Payment(s) | collection | contract | access |
| --- | --- | --- | --- | --- |
| Checkout en cours | 1× `open` | `pending` | `pending` | `not_eligible` |
| Payé, NDA à signer | 1× `paid` | `current` / `paid` | `sent` | `not_eligible` |
| Payé + NDA signé, invite en cours | `paid`… | `current` / `paid` | `signed` | `pending` |
| Accès OK, plan ×4 à jour | 2× `paid`, 2× `open` | `current` | `signed` | `active` |
| Échéance ratée | … + 1× `failed` | `past_due` | `signed` | `suspended` |
| Tout soldé | tout `paid` | `paid` | `signed` | `active` |
| Remboursé | — | `refunded` | (inchangé) | `revoked` |

`ProviderEvent.status` (interne) : `received` → `processed` / `ignored` / `failed`.

## Notifications ops (Slack)

Canal via Incoming Webhook (`SLACK_WEBHOOK_URL`).  
Facade : [`src/lib/services/slack.ts`](../src/lib/services/slack.ts) → `notifyOps`.  
Pas de table d’événements dédiée : vérité = `Enrollment` / `Payment` / `ProviderEvent` / `AdminAction`.

### Ce qu’on track

**Happy path (funnel)**

| Kind | Quand |
| --- | --- |
| `checkout.created` | 1re session Checkout (+ plan financier) |
| `payment.first_confirmed` | 1er paiement confirmé (entrée funnel) |
| `nda.sent` | Lien Yousign provisionné |
| `nda.signed` | NDA signé |
| `access.active` | Invité Teachizy / accès actif |

**Argent**

| Kind | Quand |
| --- | --- |
| `payment.installment_paid` | Chaque échéance qui passe à `paid` (`1/4`, `2/4`…) |
| `collection.past_due` | Collection en retard |
| `collection.paid` | Collection soldée |
| `collection.refunded` | Collection remboursée |

**Alertes**

| Kind | Sévérité | Quand |
| --- | --- | --- |
| `nda.monitor` | warn/critical | Yousign declined / expired / delivery fail… |
| `access.suspended` | warn | Accès Teachizy suspendu |
| `access.revoked` | critical | Accès révoqué |
| `job.final_failure` | critical | Job Inngest à bout de retries |
| `admin.action` | info/warn | Toute action admin réussie (`recreate_nda` = warn) |
| `ops.reconcile_issues` | warn | Reconcile trouve ≥1 incohérence |

### Hors scope (bruit)

Magic link, webhook `received` / `ignored`, steps Inngest skippés, retry checkout (session déjà présente), queue `grant` (l’info utile = `access.active`).

### Format message

```
[severity] kind — title
Inscription: …
E-mail: …
Détail: …
```

Sans `SLACK_WEBHOOK_URL` : warn console, parcours métier inchangé.

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
- Slack = canal ops (facade `notifyOps`), pas un second journal d’événements

## Avant prod

1. NDA juridique final + template Yousign
2. Produit/prix Stripe live + webhooks
3. Clés Teachizy + UUID formation
4. Domaine Resend, Slack, DNS `formation.deesse-vibes.com`
5. CGV + confidentialité
