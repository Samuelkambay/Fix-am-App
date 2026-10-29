# FixAm Salone 🇸🇱🔧

An on-demand handyman marketplace for Sierra Leone. It covers the same ground as 6amTech's *Demandium* (customer app, provider app, serviceman app, provider panel, admin panel, customer website), rebuilt around local realities:

- **mobile money** first (Orange Money, Afrimoney, QMoney, Monime),
- **cash** handled properly,
- **USSD** for feature phones,
- **verification badges** you can check before opening the gate,
- transparent **peak-hour pricing**,
- configurable **commission and subscription** plans with 15% GST.

| Folder | What | Stack |
|---|---|---|
| [`backend/`](backend/) | REST API, rule engines, payment gateways, USSD, background jobs | Node 20+, TypeScript, Express, PostgreSQL |
| [`customer-web/`](customer-web/) | Customer website: browse, price-by-hour, book, pay, track, verify | React 18 + Vite |
| [`web/`](web/) | Admin panel + provider panel | React 18 + Vite |
| [`mobile/`](mobile/) | **FixAm** customer app and **FixAm Pro** (provider + serviceman) app | Expo / React Native |
| [`docs/`](docs/) | [Reverse-engineering report](docs/REVERSE_ENGINEERING.md) · [Architecture](docs/ARCHITECTURE.md) · [API reference](docs/API.md) | |

## Quick start

```bash
# 1. API (needs PostgreSQL; or `docker compose up`)
cd backend && npm install && cp .env.example .env
npm run seed -- --reset && npm run dev           # :4000

# 2. Customer website
cd customer-web && npm install && npm run dev    # :5180

# 3. Admin + provider panels
cd web && npm install && npm run dev             # see web/README.md

# 4. Mobile apps
cd mobile && npm install                         # see mobile/README.md
```

Demo logins (seeded):

| Role | Phone | Login |
|---|---|---|
| Admin | 076 000 001 | password `Admin@123` |
| Customer | 076 111 111 | SMS code (shown on screen in dev) |
| Provider (electrical) | 077 222 222 | SMS code |
| Provider (plumbing, has a serviceman) | 076 333 333 | SMS code |
| Serviceman | 078 444 444 | SMS code |

Payments run in **sandbox** mode by default. Every operator is simulated end to end, including signed webhooks. Test numbers ending in `000` are declined, and numbers ending in `999` never approve.

## The four core APIs

| API | Endpoints | Highlights |
|---|---|---|
| **Mobile money** | `POST /payments`, `GET /payments/:id`, `POST /webhooks/payments/:gateway`, `/wallet/payouts` | One gateway interface for Orange Money, Afrimoney, QMoney and Monime. Required idempotency keys, HMAC-signed webhooks with replay protection, de-duplication, immutable final states, reconciliation job. Checks the wallet matches the SIM network. Payouts and refunds go through a ledger. |
| **Peak-hour pricing** | `POST /pricing/quote`, `GET /pricing/day-curve`, `/pricing/rules`, `/pricing/simulate` | Time-window, holiday, seasonal, demand and urgency rules. Priority plus stacking, a multiplier cap and a surcharge cap. 15-minute price locks. An hourly price curve so customers can shift to off-peak. |
| **Authentication badges** | `/badges/apply`, `/badges/applications/:id/review`, `/badges/verify/:code` | ID, police clearance, trade certificate and business registration badges with private document review, expiry and revocation. Automatic performance badges. A trust score drives ranking. Badges gate who can accept jobs. Public verification works over web and USSD. |
| **Commission structure** | `/commission/plans`, `/commission/simulate`, `/providers/me/commission-preview` | Commission, subscription and hybrid plans. Category rates, 30-day volume tiers, negotiated overrides, a lower rate on peak surcharge, min and max commission, 15% GST. Cash jobs create commission owed, with a limit that blocks new jobs until settled. |

Plus OTP auth with token rotation, zones, catalog, the booking lifecycle with start and completion codes, disputes with ledger reversal, reviews, uploads, an SMS outbox, the admin dashboard, settings and the audit log.

## Tests

- `backend`: `npm test` runs **66 tests**: unit tests for the pricing, commission and phone-number logic, and end-to-end API flows against Postgres covering payments, webhooks, cash limits, subscriptions, badges, payouts, disputes, USSD the dashboard, and regressions found by the panel smoke test.
- `customer-web`: `node scripts/e2e.cjs` drives the full booking and payment flow in Chromium against the live API and saves screenshots.
- `web` and `mobile`: see their READMEs for smoke and flow tests.

## Before going live in Sierra Leone

1. **Payments.** Get merchant accounts with Orange Money SL, Africell (Afrimoney) and Qcell (QMoney), or one with Monime. Fill in each operator's request and response mapping in `backend/src/modules/payments/gateways/http-merchant.ts` (and confirm Orange WebPay availability for SL), set `PAYMENT_MODE=live`, and run a Le 1 collection and payout per operator.
2. **Telecoms.** Confirm the mobile number prefixes against the current NatCA numbering plan (they're editable in the `phone_prefixes` setting). Get a USSD short code and an SMS sender ID through an aggregator. Set `USSD_SHARED_SECRET`.
3. **Tax and legal.** Register for GST with the NRA and confirm the 15% rate and how commission is treated. Use a privacy policy that covers ID documents, and move uploads to encrypted object storage.
4. **Localisation.** Have a native speaker review the Krio strings. Set launch prices and holiday dates (Eid dates vary each year) from local research.
5. **Hardening.** Add global rate limiting, admin staff roles, monitoring and backups.
