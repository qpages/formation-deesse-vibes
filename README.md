# Formation Déesse Vibes

Portail `formation.deesse-vibes.com` — Formation Matrice Évolution (320 €).

Parcours : landing → Stripe Checkout → NDA Yousign → Make → Teachizy.  
Suivi sur la même page via lien magique Resend. Accès Teachizy uniquement via webhooks vérifiés.

## Stack

- Astro 7 SSR + Vercel
- Neon Postgres + Prisma
- Stripe, Yousign, Inngest, Resend, Make, Slack
- Admin : `/admin` (credentials env `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

## Démarrage

```bash
cp .env.example .env   # remplir les secrets
npm install
npm run db:migrate
npm run dev
```

Scripts utiles : `npm test`, `npm run build`, `npm run db:deploy`.

Détails produit / décisions : [`PLAN.md`](./PLAN.md).  
Consoles & webhooks : [`TOOLS.md`](./TOOLS.md).
