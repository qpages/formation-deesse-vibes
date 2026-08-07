# Notifications ops (Slack)

Canal ops via Incoming Webhook (`SLACK_WEBHOOK_URL`).  
Facade unique : [`src/lib/services/slack.ts`](../src/lib/services/slack.ts) → `notifyOps`.

Pas de table d’événements dédiée : la vérité reste dans `Enrollment` / `ProviderEvent` / `AdminAction`.

## Catalogue

| Kind | Sévérité | Seam |
| --- | --- | --- |
| `checkout.created` | info | `startCheckout` — 1re session seulement (+ plan financier) |
| `payment.first_confirmed` | info | `confirmPaidCheckout` — transition `pending` → payé |
| `collection.past_due` | warn | `recomputeEnrollmentCollectionState` |
| `collection.paid` | info | idem |
| `collection.refunded` | warn | idem |
| `nda.sent` | info | `createNdaAfterPayment` après provision |
| `nda.signed` | info | webhook / sync Yousign → `signed` |
| `nda.monitor` | warn/critical | événements Yousign MONITOR |
| `access.active` | info | `grantTeachizyAccess` après invite |
| `access.suspended` | warn | `applyAccessPolicy` |
| `access.revoked` | critical | `applyAccessPolicy` |
| `job.final_failure` | critical | Inngest `onFailure` |
| `admin.action` | warn | `recreate_nda` |
| `ops.reconcile_issues` | warn | reconcile si count > 0 |

## Hors scope (bruit)

Magic link, webhook `received` / `ignored`, steps Inngest skippés, retry checkout (session déjà présente), queue `grant` (l’info utile = `access.active`).

## Format message

```
[severity] kind — title
Inscription: …
E-mail: …
Détail: …
```

Sans `SLACK_WEBHOOK_URL` : warn console, parcours métier inchangé.
