# FixAm Salone – web dashboard

One React app with two role-based areas for the FixAm handyman marketplace:

- **Admin panel** (`/admin/*`): dashboard, bookings, providers, badge verification, peak pricing, commission plans, payments, payouts, catalog, zones, settings, SMS outbox, audit log.
- **Provider panel** (`/provider/*`): overview, jobs, earnings & wallet, badges, plans, services & zones, team.

React 18, Vite, TypeScript and react-router, with plain CSS (a small token-based design system in `src/styles/global.css`, light and dark). The only other runtime dependency is `recharts`, which loads only on the admin dashboard.

## Run

The backend API must be running on `http://localhost:4000` (see `../backend`).

```bash
npm install
npm run dev          # http://localhost:5173, proxies /api to http://localhost:4000
```

Demo logins:

| Role | How |
|---|---|
| Admin | **Admin** tab, phone `076 000 001`, password `Admin@123` |
| Provider | **Provider** tab, phone `077 222 222` (Bright Spark), `076 333 333` (Salone Plumbing) or `030 555 556` (Bo Cool, pending). In dev the API returns the SMS code and the page shows it with a **Fill in** button. |

The API allows 3 codes per phone per 10 minutes. A phone with no provider account logs in as a customer and is taken to **Register as a provider**.

## Build

```bash
npm run build        # tsc --noEmit, then vite build into dist/
npm run preview      # serves dist/ on http://localhost:4173, with the same /api proxy
npm run typecheck
```

Every route is its own lazy chunk. The first load is about 70 kB gzipped (React, the router and the app shell). The chart chunk (about 100 kB gzipped) loads only on the admin dashboard, after the KPI tiles show.

## Environment

Copy `.env.example` to `.env` if you need to change anything:

| Variable | Default | Used by |
|---|---|---|
| `VITE_API_URL` | `/api/v1` | Browser. The API base URL. Set an absolute URL (e.g. `https://api.fixam.sl/api/v1`) to call a remote API directly; the API sends permissive CORS headers. |
| `API_PROXY_TARGET` | `http://localhost:4000` | Vite dev and preview servers only. Where `/api` is proxied. |

## Code map

```
src/api/client.ts      fetch wrapper: base URL, bearer token, one shared /auth/refresh on 401, errors parsed into ApiError {status, code, message, details}
src/api/types.ts       entity types (snake_case rows, camelCase request bodies)
src/api/index.ts       typed endpoint functions grouped by module (authApi, bookingsApi, pricingApi, …)
src/lib/format.ts      Le formatting (minor units → "Le 1,250"), % ↔ bps, SL phone parsing/formatting, Freetown dates
src/lib/labels.ts      gateway names, accept_blockers → plain English, document labels
src/components/        ui primitives, Shell (sidebar layout), PaymentFlow, DocumentViewer, BadgeVerifier, BookingDetail
src/pages/admin/       admin pages
src/pages/provider/    provider pages (share /providers/me through a context)
```

Conventions:

- **Money** is integer minor units everywhere in state. `MoneyInput` edits it in Leones, and `PercentInput` edits basis points as %.
- **Phones** are typed in local form (`076 123 456`) and formatted as you type. The API normalises them to E.164.
- **Sessions** are stored in `localStorage` (`fixam.session`). A 401 triggers one token rotation through `/auth/refresh` and a retry. If that fails, the user is logged out.
- **Mobile money** (`PaymentFlow`): it suggests the wallet that matches the number's network (`/payments/methods?msisdn=`) and sends `POST /payments` with an `Idempotency-Key`. The key is reused only when retrying after a network failure. It then polls `GET /payments/:id` every 3 seconds and shows `customer_action.message`. In sandbox it offers **Simulate approval/decline**.
- **Private uploads**: badge documents are fetched as blobs with the auth header and shown in a modal. Photos over 700 kB are downscaled in the browser before upload.

## Scripts

```bash
node scripts/smoke.mjs          # or: npm run smoke
npm run build && node scripts/screenshots.mjs   # or: npm run screenshots
```

- `smoke.mjs` logs in as the admin (password), the providers and the demo customer (OTP, cached in `scripts/.smoke-tokens.json` and refreshed with `/auth/refresh` so reruns do not hit the OTP limit). It calls every endpoint the UI uses: about 150 checks across about 77 endpoints, including real job lifecycles (mobile money, cash, dispute, serviceman), payouts, badge upload/review/verify, pricing and commission simulators, a subscription purchase and a cash-commission settlement. It writes `scripts/smoke-report.json`. **It changes the dev database** (creates bookings and payments; adds an inactive smoke plan, zone, category and service each run).
- `screenshots.mjs` starts `vite preview` if needed and captures every page at 1440×900, plus mobile (390×844) shots, into `screenshots/`. It fails if any page logs a console error or gets a 4xx/5xx from the API. It uploads a clearly labelled **SAMPLE** document so the admin document viewer has something to show.
