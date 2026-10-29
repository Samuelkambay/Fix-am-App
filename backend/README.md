# FixAm API

Node.js 20+ / TypeScript / Express / PostgreSQL 14+.

```bash
cp .env.example .env            # defaults work for local dev
npm install
npm run migrate
npm run seed -- --reset         # Sierra Leone zones, trades, pricing rules, plans, badges + demo accounts
npm run dev                     # http://localhost:4000/api/v1/health
```

| Script | What it does |
|---|---|
| `npm test` | Unit tests (pricing, commission, phone numbers) and end-to-end API flows against `fixam_test` (override with `TEST_DATABASE_URL`). |
| `npm run build && npm start` | Production build (`dist/`). Migrations run on boot. |
| `npm run jobs` | Runs the background jobs once (for cron, when `RUN_JOBS=false`). |
| `npm run seed -- --reset --no-demo` | Reference data only. |

Layout:

```
src/
  app.ts, server.ts, config.ts, db.ts
  db/            migrations/001_init.sql, migrate.ts, seed.ts, seed-data.ts
  lib/           money, phone (SL numbering + operator detection), time (Africa/Freetown), crypto, http
  jobs/          scheduler (reconcile payments, expire badges/subscriptions/requests)
  modules/
    auth  zones  catalog  providers  bookings  reviews  uploads  ussd  admin  settings  notifications
    pricing/     pricing.engine.ts (pure)   pricing.service.ts   pricing.routes.ts
    commission/  commission.engine.ts (pure) commission.service.ts (settlement) commission.routes.ts
    payments/    gateways/{sandbox,orange-webpay,http-merchant,signing}.ts  payments.service.ts  payments.routes.ts
    badges/      badges.service.ts  badges.routes.ts
    wallet/      ledger.ts  payouts.service.ts  wallet.routes.ts
```

See [`../docs/API.md`](../docs/API.md) for every endpoint and [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for how pricing, commission, payments and badges work.

## Going live with mobile money

1. Get merchant accounts with Orange Money SL, Africell Afrimoney and Qcell QMoney (KYC/KYB at their business offices), or one account with Monime, which covers all networks.
2. Put the credentials in `.env` and set `PAYMENT_MODE=live`.
3. Point each operator's callback URL at `https://<your-domain>/api/v1/webhooks/payments/<gateway>`.
4. Fill in the request and response mapping in `src/modules/payments/gateways/http-merchant.ts` from each operator's spec. For Orange, confirm that WebPay is enabled for Sierra Leone and set the `ORANGE_MONEY_*` values.
5. Do a live Le 1 collection and a Le 1 payout per operator before launch.

Gateways that aren't configured simply disappear from `/payments/methods`.
