# Formation Déesse Vibes

Portail `formation.deesse-vibes.com` — Formation Matrice Évolution (320 €).

Parcours : landing → Stripe Checkout → NDA Yousign → Teachizy.  
Suivi sur la même page via lien magique Resend. Accès Teachizy uniquement via API directe après signature vérifiée.

## Stack

- Astro 7 SSR + Vercel
- Neon Postgres + Prisma
- Stripe, Yousign, Inngest, Resend, Teachizy, Slack
- Admin : `/admin` (credentials env `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

## Liens utiles

- [Documentation API Teachizy](https://developer.teachizy.fr/)

## Démarrage

```bash
cp .env.example .env   # remplir les secrets
npm install
npm run db:migrate
npm run dev
```

Scripts utiles : `npm test`, `npm run build`, `npm run db:deploy`.

Vue d’ensemble (parcours, Inngest, webhooks, consoles) : [`docs/overview.md`](./docs/overview.md).
