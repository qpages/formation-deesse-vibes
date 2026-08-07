# Statuts d’une inscription

Quatre notions à ne pas confondre :

| Champ | Où | Question qu’il répond |
| --- | --- | --- |
| `Payment.status` | chaque échéance | Cette facture est-elle payée ? |
| `collectionStatus` | l’inscription | L’élève est-il à jour sur l’ensemble ? |
| `contractStatus` | l’inscription | Où en est le NDA ? |
| `accessStatus` | l’inscription | A-t-il accès à Teachizy ? |

`Payment.status` = une ligne.  
`collectionStatus` = le résumé de toutes les lignes.

---

## Parcours normal

```
Checkout ouvert
  → 1er paiement OK
  → NDA envoyé → NDA signé
  → création accès Teachizy
  → accès OK
  → (éventuellement) échéances suivantes jusqu’à solde
```

---

## `Payment.status` — une échéance

Chaque paiement (facture / installment Stripe) a son propre statut.

| Valeur | En clair |
| --- | --- |
| `draft` | Pas encore exigible |
| `open` | À payer |
| `paid` | Payé |
| `failed` | Échec de paiement |
| `void` | Annulé |
| `uncollectible` | On ne récupère plus |

Exemple plan ×4 : 4 lignes Payment, chacune avec son `status`.

---

## `collectionStatus` — l’ensemble de l’argent

Calculé à partir des paiements + du plan. C’est le statut “caisse” de l’inscription.

| Valeur | En clair |
| --- | --- |
| `pending` | Rien encaissé pour l’instant |
| `current` | À jour, d’autres échéances à venir |
| `past_due` | Au moins une échéance en retard |
| `paid` | Tout est payé |
| `canceled` | Commande annulée |
| `refunded` | Remboursé |

Lien typique :

- plusieurs `Payment.status = paid` + reste à venir → `collectionStatus = current`
- un `Payment.status = failed` (après le 1er) → souvent `collectionStatus = past_due`
- toutes les lignes `paid` → `collectionStatus = paid`

---

## `contractStatus` — le NDA

| Valeur | En clair |
| --- | --- |
| `pending` | Pas encore envoyé |
| `sent` | Envoyé, en attente de signature |
| `signed` | Signé |
| `expired` | Expiré |
| `declined` | Refusé |
| `canceled` | Annulé |
| `error` | Échec technique (création / sync) |

Côté Yousign, la demande a aussi un statut technique (`YousignRequest.status` : `ongoing`, `done`, etc.).  
C’est le miroir provider ; `contractStatus` reste la référence métier.

---

## `accessStatus` — Teachizy

| Valeur | En clair |
| --- | --- |
| `not_eligible` | Conditions pas remplies → pas d’accès (encore) |
| `pending` | Conditions OK → on crée l’accès |
| `active` | Accès ouvert |
| `suspended` | Accès coupé pour l’instant (souvent impayé) |
| `revoked` | Accès retiré pour de bon (annulation / remboursement) |

Conditions pour sortir de `not_eligible` :

1. 1er paiement OK  
2. NDA signé  
3. pas d’impayé bloquant  
4. pas annulé / remboursé  

`not_eligible` = “pas encore”, pas “interdit / sanctionné”.  
Si la personne avait déjà un accès et qu’un problème arrive → `suspended` ou `revoked`, pas un retour “neutre” à `not_eligible` (sauf cas où l’accès n’avait jamais été activé).

---

## Exemples

| Situation | Payment(s) | collection | contract | access |
| --- | --- | --- | --- | --- |
| Checkout en cours | 1× `open` | `pending` | `pending` | `not_eligible` |
| Payé, NDA à signer | 1× `paid` | `current` / `paid` | `sent` | `not_eligible` |
| Payé + NDA signé, invite en cours | `paid`… | `current` / `paid` | `signed` | `pending` |
| Accès OK, plan ×4 à jour | 2× `paid`, 2× `open` | `current` | `signed` | `active` |
| Échéance ratée | … + 1× `failed` | `past_due` | `signed` | `suspended` |
| Tout soldé | tout `paid` | `paid` | `signed` | `active` |
| Remboursé | — | `refunded` | (inchangé) | `revoked` |

---

## Bonus (interne)

`ProviderEvent.status` : cycle d’un webhook Stripe/Yousign — `received` → `processed` / `ignored` / `failed`.
