# Formation Matrice Évolution

Portail `formation.jessica-stamck.com` — 1 849 € TTC (paiement unique ; majoration en échéances). Accès Teachizy uniquement après paiement + NDA signé (jamais depuis une page succès client).

## Parcours

```
Landing → Stripe Checkout → NDA (DocuSeal par défaut) → Teachizy (API)
              ↑                              ↓
       même page `/` ← reconnexion sur le site (e-mail d’ouverture Brevo)
```

1. Formulaire (nom, prénom, e-mail, consentements) → Checkout Stripe
2. Webhook Stripe vérifié → Inngest `createNdaAfterPayment` → demande de signature (DocuSeal ou Yousign selon `SIGNATURE_PROVIDER`)
3. Signature NDA → webhook provider → Inngest `grantTeachizyAccess` → API Teachizy
4. Retour plus tard : e-mail d’ouverture → formation.jessica-stamck.com (même page)

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

Miroir provider (`nda_requests`) : statut technique (`ongoing`, `done`…). Référence métier = `contractStatus`.

### Miroir signataire (provider)

Détail d’engagement côté signataire (pas de nouveau `contractStatus`) :

| Champ | Source | Rôle |
| --- | --- | --- |
| `ndaRequest.providerStatus` | API / webhooks | `initiated` → `notified` → … → `signed` |
| `signatureLinkExpiresAt` | API Signer | Expiration du magic link (~48h, surtout Yousign redirect) |
| `ndaNotifiedAt` | webhook notified (+ sync) | E-mail parti / lien prêt |
| `ndaLinkOpenedAt` | webhook link_opened | Lien ouvert |
| `ndaSignedAt` | signature done / `signed_at` | Date de signature |
| `ndaDeliveryFailedAt` | webhook delivery_failed | Bounce e-mail |

Engagement (`notified`, `link_opened`) : webhooks **sans Slack**.  
Alertes Slack : `nda.monitor` (échecs) + `nda.signed`.  
Le lien de signature n’est **jamais** stocké : fetch live (`getSignSurface`) pour l’élève / action admin « Copier le lien ».

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
| `nda.sent` | Demande de signature provisionnée |
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
| `nda.monitor` | warn/critical | Signature declined / expired / delivery fail… |
| `access.suspended` | warn | Accès Teachizy suspendu |
| `access.revoked` | critical | Accès révoqué |
| `job.first_failure` | warn | 1er échec Inngest (retries à suivre) |
| `job.recovered` | info | Succès après retry |
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

Astro 7 SSR (Vercel) · Prisma Postgres + Prisma ORM · Stripe · DocuSeal (défaut) / Yousign · Teachizy · Inngest · Brevo · Slack  
Admin `/admin` : `ADMIN_EMAIL` / `ADMIN_PASSWORD` + JWT

## Inngest

| Fonction | Events | Cron | Retries | Rôle |
| --- | --- | --- | --- | --- |
| `processStripeWebhook` | `provider/stripe-event.received` | — | 2 | Traite un `ProviderEvent` Stripe (idempotent) |
| `processYousignWebhook` | `provider/yousign-event.received` | — | 2 | Traite un `ProviderEvent` Yousign (idempotent, si `SIGNATURE_PROVIDER=yousign`) |
| `processDocusealWebhook` | `provider/docuseal-event.received` | — | 2 | Traite un `ProviderEvent` DocuSeal (idempotent, défaut) |
| `createNdaAfterPayment` | `stripe/payment.confirmed`, `admin/recreate-nda` | — | 2 | Crée / active le NDA (alerte Slack) |
| `grantTeachizyAccess` | `nda/signature.completed`, `enrollment/access.grant` | — | 2 | Invite Teachizy (alerte Slack) |
| `resendNda` | `admin/resend-nda` | — | 3 | Renvoie le lien (Yousign redirect uniquement) |
| `reconcileEnrollments` | `ops/reconcile-enrollments` | `0 4 * * *` | 2 | Ré-applique `applyAccessPolicy` |
| `purgeWebhookPayloads` | `ops/purge-webhook-payloads` | `0 3 * * *` | 2 | Null les payloads chiffrés > 30 j |

**Handoffs async (invariants 1–2 ci-dessous) :** sans enqueue, la DB peut être à jour et l’élève quand même bloqué.

**Contrat d'erreur de l'enqueue (via `sendInngestSafe`) :**

- Chemin **dur** (webhook, retour Checkout) : une file HS **rejette** → Inngest rejoue.
- Chemin **soft** (sync admin, `opts.soft` / `softEnqueue`) : l'effet primaire (miroir DB)
  est déjà persisté ; une file HS renvoie `EnqueueResult { status: 'failed' }`. L'action
  admin réussit quand même (loggée), avec un toast d'avertissement invitant à relancer.

Cette séparation distingue les **actions `sync`** (miroir DB = effet primaire, enqueue
best-effort) des **actions `flow`** (l'enqueue Inngest *est* l'action → 503 si file HS),
cf. `AdminActionDef.execution` dans `src/lib/admin/actions.ts`.

Local : 3 process en parallèle —

```bash
pnpm dev
pnpm dev:inngest             # http://localhost:8288
pnpm webhook:stripe          # coller le whsec_… dans .env
```

Endpoint app : `/api/inngest`  
Dashboard Inngest : http://localhost:8288

## Webhooks

| Source | Endpoint |
| --- | --- |
| Stripe | `POST /api/webhooks/stripe` |
| DocuSeal | `POST /api/webhooks/docuseal` |
| Yousign | `POST /api/webhooks/yousign` |
| Inngest | `GET/POST /api/inngest` |

> ⚠️ **L'URL webhook DOIT inclure le chemin complet.** Une URL sans chemin
> (ex. `https://xxxx.ngrok-free.dev`) POST à la racine → le handler n'est jamais
> atteint → **0 run Inngest** sur signature/paiement (cause du symptôme « il faut
> actualiser »). Config exacte à renseigner côté provider :
>
> - **DocuSeal** → URL `https://<host>/api/webhooks/docuseal`. Événements à cocher :
>   `form.completed` (mono-signataire) **et/ou** `submission.completed`. Signature
>   HMAC : onglet Security → HMAC, copier le `whsec_…` dans `DOCUSEAL_WEBHOOK_SECRET`
>   (header `X-Docuseal-Signature`, format `timestamp.signature`). `form.viewed`/
>   `form.started` sont ignorés côté app (200 no-op), inutile de les retirer.
> - **Stripe** → endpoint `https://<host>/api/webhooks/stripe`, événements :
>   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
>   `invoice.*`, `customer.subscription.*`, `subscription_schedule.*`,
>   `charge.refunded`, `charge.dispute.created`. Secret `whsec_…` → `STRIPE_WEBHOOK_SECRET`.
>
> Filet sans webhook : le polling client rejoue `reconcileEnrollment` via
> `POST /api/enrollment/reconcile`, donc la page avance même si un webhook manque —
> mais configurez quand même les webhooks pour les effets serveur (accès Teachizy).

## Consoles

| Outil | URL / notes |
| --- | --- |
| Prisma Postgres | https://console.prisma.io |
| Stripe | prix `STRIPE_PRICE_UNIQUE` (1 849 €) + X2/X4/X6 |
| DocuSeal | template NDA + webhook (`SIGNATURE_PROVIDER=docuseal`, défaut) |
| Yousign | template NDA côté Yousign (option `SIGNATURE_PROVIDER=yousign`) |
| Brevo | from `formation@deesse-vibes.com` |
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
- NDA signé stocké chez le provider (IDs seulement en DB)
- Payloads webhook chiffrés, rétention 30 jours
- Preview ≠ prod (Stripe / DocuSeal ou Yousign / Teachizy / Prisma Postgres)
- Slack = canal ops (facade `notifyOps`), pas un second journal d’événements

## Qualité : invariants → tests → gate live

Trois filets. Un audit code (skills `.cursor/skills/audit-*`) est un **radar**, pas un frein.

```
Invariant (règle métier)
    → Test (alarme auto si on casse la règle)
    → Gate live (pas de sk_live tant qu’une case rouge)
```

### Invariants (non négociables)

Si un invariant est faux en prod = incident. Chaque règle doit avoir **un owner code** et **un test**

| # | Règle | Owner typique | Si violé |
| --- | --- | --- | --- |
| 1 | 1er paiement confirmé → `ensureNdaAfterPayment` sur **tous** les chemins (webhook Stripe, retour Checkout, sync admin) | Inngest / payments | Élève payé, jamais de NDA |
| 2 | NDA `signed` → `ensureTeachizyAfterSignature` sur **tous** les chemins (webhook provider, sync admin) | Inngest / access | NDA OK, pas d’accès |
| 3 | Plans `x2` / `x4` / `x6` : Subscription Schedule avec durée = N mois et `end_behavior: cancel` (pas d’abo infini). API Stripe actuelle : `phases[].duration`, **pas** `iterations` | `src/lib/stripe.ts` | Prélèvements au-delà du plan |
| 4 | Pas d’`accessStatus: active` sans 1er paiement OK + `contractStatus: signed` + pas d’impayé bloquant | `access` / eligibility | Accès cours non autorisé |
| 5 | `collectionStatus: past_due` → accès Teachizy coupé (`suspended`) via API réelle, pas DB-only | Teachizy + payments | Cours ouverts malgré impayé |
| 6 | `collectionStatus: refunded` (refund/dispute) → `accessStatus: revoked` | Stripe webhooks + access | Accès après remboursement |
| 7 | Webhooks Stripe / provider signature : signature vérifiée ; même event id → pas de double effet métier | webhook handlers | Double NDA / double charge logique |
| 8 | Lien de signature **jamais** persisté en DB (fetch live seulement) | signature / enrollment | Fuite / lien périmé stocké |

Gaps connus (ne pas oublier au gate) : Teachizy suspend/revoke API, refund→revoke, Brevo transactional complet.

### Tests (preuve exécutable)

Minimum avant live — au-delà = bonus.

| Niveau | Quoi | Done when |
| --- | --- | --- |
| Unitaire | Payload `ensureSubscriptionSchedule` : `duration` + `end_behavior: cancel` ; pas de `iterations` | `pnpm test` rouge si on régresse |
| Unitaire | Eligibility accès + mapping refund/past_due → statut accès | Idem |
| Unitaire / intégration | Idempotence `ProviderEvent` (replay même id) | Pas de double side-effect |
| E2E test-mode | Parcours **unique** : payé → NDA → invite Teachizy | Checklist gate live ci-dessous |
| E2E test-mode | Parcours **x4** : schedule Stripe = 4 mois + cancel ; pas de 5e prélèvement | Vérifié Dashboard test ou API |
| E2E test-mode | Magic link → même page `/` statut cohérent | OK manuel ou scripté |

Règle : un finding **blocker** d’audit → ticket **+** test de non-régression avant de passer à autre chose.

Audits domaine (optionnel, en vague) : `.cursor/skills/audit-critical-suite` — d’abord `stripe-money` + `webhooks` + `teachizy-access`.

### Gate live (feu rouge)

**Une case rouge = pas de clé `sk_live` / pas d’ouverture publique du paiement.**

Copier dans la PR ou le runbook ; cocher seulement avec preuve (lien Dashboard, log test, CI verte).

**Bloquants absolus**

- [ ] Invariants 1–4 + 7–8 tenus dans le code **et** couverts par au moins un test ou E2E
- [ ] Invariants 5–6 : implémentés **ou** décision écrite d’accepter le risque (sinon NO-GO)
- [ ] Stripe **test** : parcours unique + x4 OK (schedule s’arrête)
- [ ] Stripe **live** : prix + webhooks endpoint prod verts
- [ ] Provider signature (DocuSeal ou Yousign) : template NDA juridique final + webhook prod
- [ ] Teachizy : UUID formation + invite OK ; coupe accès réelle si 5 exigé
- [ ] DB prod migrée (`prisma migrate deploy`)
- [ ] Secrets prod ≠ défauts ; admin password fort ; secrets JWT/session ≥ 32
- [ ] DNS `formation.jessica-stamck.com` → Vercel (`formation-deesse-vibes.vercel.app` en fallback) ; e-mail from domaine vérifié
- [ ] Inngest cloud branché sur `/api/inngest`

**Fortement recommandés**

- [ ] Slack ops branché (`notifyOps`)
- [x] CGV / confidentialité / mentions
- [ ] Handoff accès outils au client (consoles Stripe, DocuSeal/Yousign, Teachizy, Vercel)

**Verdict**

| Résultat | Condition |
| --- | --- |
| **NO-GO** | ≥1 bloquant absolu ouvert, ou invariant 3/4/7 cassé |
| **GO avec conditions** | Bloquants OK ; gaps 5–6 ou Brevo listés avec owner + date |
| **GO** | Bloquants + recommandés OK |
