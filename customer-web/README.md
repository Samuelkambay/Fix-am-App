# FixAm customer website

The customer-facing web app (the equivalent of Demandium's customer website). Mobile-first React 18 + Vite + TypeScript, with no UI framework and no web fonts: the main bundle is about 62 KB gzipped, so it loads on slow 3G.

```bash
npm install
npm run dev            # http://localhost:5180, proxies /api to the API on :4000
npm run build && npm run preview
```

Set `VITE_API_URL` to point at another API (default `/api/v1` through the proxy).

## Pages
| Route | What it does |
|---|---|
| `/` | Hero search, area picker (GPS or list), trade grid, verified fixers in your area, how trust and off-peak pricing work |
| `/search?q=` · `/category/:id` | Services available in the selected area |
| `/service/:id` | 7-day date picker, **price-by-hour strip** (peak hours in orange, cheapest marked, "book at 4pm and save Le 63"), urgent toggle, quantity, choose any verified fixer or a specific one (badges, rating, jobs) |
| `/checkout` | Landmark-based address, payment method (pre-selects the wallet for your SIM network and flags other-network wallets), price breakdown with peak labels, **15-minute price-lock countdown** |
| `/bookings`, `/bookings/:id` | Progress tracker, big **start / completion codes**, fixer details and call button, timeline, mobile money payment (approve on your phone → auto-polling; sandbox approve/decline), cancel, report a problem, rate and review |
| `/wallet` | Balance, history, top up by mobile money |
| `/verify`, `/verify/:code` | Public badge check: big green VALID or red NOT VALID |
| `/providers/:id` | Profile, badges with verification codes, services and prices, reviews |
| `/login`, `/profile` | Phone + SMS code login (the demo code is shown in dev), name, English / Krio |

## End-to-end check
`node scripts/e2e.cjs [baseUrl]` drives the real flow in Chromium against the live API: OTP login → category → service → peak-hour warning → quote → checkout → Orange Money (sandbox) → paid booking with start code → bookings → badge verify (valid and invalid) → provider profile → wallet, plus desktop views. Screenshots go to `screenshots/`. It exits non-zero on any failure or browser console error.

Krio strings in `src/lib/i18n.tsx` are a first draft and need native-speaker review.
