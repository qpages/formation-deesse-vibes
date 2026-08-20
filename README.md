# Formation Déesse Vibes

Portail `formation.jessica-stamck.com` — Formation Matrice Évolution (1 849 €).

Parcours : landing → Stripe Checkout → NDA (DocuSeal par défaut, Yousign optionnel) → Teachizy.  
Suivi sur la même page via lien magique Brevo. Accès Teachizy uniquement via API directe après signature vérifiée.

## Stack

- Astro 7 SSR + Vercel Functions
- Postgres + Prisma ORM
- Stripe, DocuSeal / Yousign, Inngest, Brevo, Teachizy, Slack
- Admin : `/admin` (credentials env `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

## Liens utiles

- [Documentation API Teachizy](https://developer.teachizy.fr/)
- [Dashboard Prisma](https://console.prisma.io/m6drw0l75hj6xaykknxtzga2/dashboard)
- [Dashboard Inngest (production)](https://app.inngest.com/env/production)
- [SonarCloud](https://sonarcloud.io/project/overview?id=qpages_formation-deesse-vibes)

## Démarrage

```bash
cp .env.example .env   # remplir les secrets
pnpm install
pnpm db:migrate
pnpm dev
```

En local, le parcours paiement → NDA nécessite aussi :

```bash
pnpm dev:inngest
pnpm webhook:stripe   # coller le whsec_… affiché dans .env → STRIPE_WEBHOOK_SECRET
```

Scripts utiles : `pnpm test`, `pnpm build`, `pnpm db:deploy`.

Vue d’ensemble (parcours, statuts, invariants, tests, gate live) : [`docs/overview.md`](./docs/overview.md).

## Flow

Le flow métier complet :

commande créée
→ paiement initial validé
→ signature demandée
→ contrat signé
→ accès actif
→ échéances suivantes
→ payé intégralement

avec des branches :

échéance échouée → grâce → suspension → régularisation → réactivation
signature expirée/refusée → relance ou annulation
remboursement/litige → suspension ou révocation