# Formation Déesse Vibes

Portail `formation.deesse-vibes.com` — Formation Matrice Évolution (1 849 €).

Parcours : landing → Stripe Checkout → NDA Yousign → Teachizy.  
Suivi sur la même page via lien magique Resend. Accès Teachizy uniquement via API directe après signature vérifiée.

## Stack

- Astro 7 SSR + Vercel Functions
- Postgres + Prisma ORM
- Stripe, Yousign, Inngest, Resend, Teachizy, Slack
- Admin : `/admin` (credentials env `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

## Liens utiles

- [Documentation API Teachizy](https://developer.teachizy.fr/)
- [Dashboard Prisma](https://console.prisma.io/m6drw0l75hj6xaykknxtzga2/dashboard)

## Démarrage

```bash
cp .env.example .env   # remplir les secrets
npm install
npm run db:migrate
npm run dev
```

En local, le parcours paiement → NDA nécessite aussi :

```bash
npm run inngest:dev
npm run webhook:stripe   # coller le whsec_… affiché dans .env → STRIPE_WEBHOOK_SECRET
```

Scripts utiles : `npm test`, `npm run build`, `npm run db:deploy`.

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