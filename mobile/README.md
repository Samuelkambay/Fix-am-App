# FixAm Salone mobile apps

Two Expo (React Native + TypeScript) apps for the FixAm on-demand handyman marketplace, in one npm-workspaces monorepo:

| App | Package | Who | Brand |
|---|---|---|---|
| **FixAm** | `apps/customer` | Customers booking a fixer | Salone green `#0B7A3E` |
| **FixAm Pro** | `apps/pro` | Providers (business owners) **and** their servicemen; the UI switches on `user.role` | Navy `#123C69` |

Both run on Android, iOS and the web (react-native-web). They talk to the API in `../backend` (see `../docs/API.md`).

```
mobile/
├── package.json              workspaces + root scripts
├── packages/shared/          @fixam/shared
│   ├── src/                  framework-free core (runs under Node too)
│   │   ├── client.ts         fetch wrapper: bearer token, single-flight refresh on 401, timeouts, ApiError
│   │   ├── api.ts            typed endpoints, 1:1 with backend/src/modules/*/*.routes.ts
│   │   ├── types.ts          entity types (snake_case rows, camelCase bodies)
│   │   ├── payments.ts       PaymentSession: Idempotency-Key reuse, 3 s polling, resume after app restart
│   │   ├── money.ts          minor units -> "Le 1,250"
│   │   ├── phone.ts          SL phone normaliser + operator/wallet detection (mirrors backend/src/lib/phone.ts)
│   │   ├── domain.ts         price-strip maths, booking state rules, accept_blockers parsing, time formatting
│   │   └── i18n/             en.ts + kri.ts (Krio: NEEDS NATIVE-SPEAKER REVIEW)
│   ├── src/ui/               @fixam/shared/ui: React Native primitives and shared flows
│   │   ├── primitives.tsx    Screen, Button (56 px), Field, CodeInput, BigCode, Banner, Choice, Pill…
│   │   ├── session.tsx       AppProviders: safe area, session, language, list cache
│   │   ├── query.ts          useApiQuery: stale-while-revalidate with an offline cache
│   │   ├── LoginFlow.tsx     phone -> OTP -> name
│   │   └── payments.tsx      MethodPicker (SIM-matched wallet) + PaymentFlow UI
│   └── scripts/flow-test.ts  headless end-to-end test against the live API
├── apps/customer/            FixAm (expo-router)
├── apps/pro/                 FixAm Pro (expo-router)
└── scripts/
    ├── serve-web.js          static server for the web builds (SPA fallback)
    └── screenshots.js        Playwright run at 390x844 -> screenshots/
```

Navigation uses **expo-router** in both apps. Tokens live in **expo-secure-store** (localStorage on web). Cached lists, the chosen zone and in-flight payment attempts live in AsyncStorage.

## Requirements

- Node 20+ (tested with Node 22) and npm 10
- Expo SDK 58 (React Native 0.88, React 19.3, TypeScript 6). No global Expo CLI is needed; use `npx expo`.
- The API running locally: `cd ../backend && PORT=4000 RUN_JOBS=false npx tsx src/server.ts`

```bash
cd mobile
npm install
```

## API URL (`EXPO_PUBLIC_API_URL`)

The apps read `EXPO_PUBLIC_API_URL` at build time. Without it they use:

| Where the app runs | Default | Notes |
|---|---|---|
| Android emulator | `http://10.0.2.2:4000/api/v1` | `10.0.2.2` is the emulator's alias for the host machine |
| iOS simulator, web | `http://localhost:4000/api/v1` | |
| Real phone (Expo Go / dev build) | none | Set it to your computer's LAN IP, e.g. `http://192.168.1.20:4000/api/v1`, on the same Wi-Fi |

Copy `apps/<app>/.env.example` to `apps/<app>/.env`, or pass it inline:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api/v1 npm run start -w @fixam/customer
```

The current URL is shown at the bottom of each app's Profile screen.

## Run the apps

```bash
npm run customer          # = npm run start -w @fixam/customer  (Expo dev server, press a / i / w)
npm run pro               # = npm run start -w @fixam/pro

# or per app
cd apps/customer && npx expo start --android      # Android emulator
cd apps/pro && npx expo start --web               # browser
```

On a device, scan the QR code with Expo Go. Camera (badge QR scan), location and the image/document pickers need a development build or Expo Go with permissions granted.

### Demo logins (OTP; the API returns `devCode` outside production, and the login screen shows it as "Test code")

| App | Phone | Account |
|---|---|---|
| FixAm | `076 111 111` | Aminata Kamara (customer). Any new SL number also works and creates a customer. |
| FixAm Pro | `077 222 222` | Bright Spark Electrical (provider) |
| FixAm Pro | `076 333 333` | Salone Plumbing Works (provider with a team) |
| FixAm Pro | `078 444 444` | Ibrahim Bangura (serviceman at Salone Plumbing) |
| FixAm Pro | `030 555 556` | Bo Cool Fridge & AC (provider pending approval: shows the blockers) |

The API allows **3 OTP codes per number per 10 minutes**. The demo numbers are shared, so if you see "Too many codes requested", wait a few minutes.

Payments run against the sandbox gateways: the payment screen shows **Simulate approval (test)**. Sandbox numbers ending `000` decline and `999` never approve.

## Web build

```bash
npm run web:build         # expo export --platform web for both apps -> apps/*/dist
npm run web:serve         # customer on http://localhost:8081, pro on http://localhost:8082
npm run screenshots       # Playwright, 390x844, logs in through the UI -> screenshots/*.png
```

The screenshot run books a real job with a fresh customer number, pays it in the sandbox, and has Bright Spark accept, start and complete it with the customer's codes. It also sets up a job assigned to the serviceman. If Bright Spark is over the cash-commission limit (other testers' cash jobs), it shows the blocker and pays the commission in the app first.

## Checks

```bash
npm run typecheck         # tsc --noEmit in packages/shared, apps/customer, apps/pro
npm run flow-test         # headless happy path against the live API (exits non-zero on failure)
FIXAM_API_URL=http://localhost:4000/api/v1 npx tsx packages/shared/scripts/flow-test.ts
```

`flow-test.ts` uses the same shared client and `PaymentSession` as the apps. It covers customer OTP login, the day curve, the quote, booking with `orange_money`, payment (create, replay with the same Idempotency-Key, simulate, poll), provider accept, en route, start and complete with codes, the review, and the provider's `job_earning` ledger entry.

## Screens

**FixAm (customer):** login (phone, OTP, name, English/Krio) · home (GPS or manual zone, category grid, search, verified fixers near you) · zone picker · category services · service (day chips, price-by-hour strip with cheapest hour and "Save Le X at HH:00", Urgent toggle, quantity, quote breakdown with peak labels and a 15-minute countdown) · choose fixer (badge chips, rating, jobs) · provider profile · address (area + required landmark, optional GPS pin, contact phone) · payment choice (cash, wallet, Orange Money, Afrimoney, QMoney, Monime; SIM-matched pre-select and mismatch warning) · confirm · payment flow · my bookings · booking detail (timeline, fixer, big start/completion codes, pay now, cancel, dispute, rate) · verify a fixer (type or scan the QR; VALID / NOT VALID) · QR scanner · wallet · top up · profile.

**FixAm Pro (provider):** login · register business · dashboard (availability, pending banner, plain-language `accept_blockers` with calls to action, balance and stats) · jobs (requests with peak/urgent tags and accept; my jobs) · job detail (landmark, call customer, assign serviceman, en route, start/complete with 4-digit codes, withdraw, earnings) · team · badges (badge card with QR and verification code, status per badge, apply) · badge application (photo/PDF upload via `POST /uploads`, then `POST /badges/apply`) · earnings (ledger, pending payouts) · withdraw · pay commission (`cash_settlement`) · plans (compare, subscribe, "what will I earn") · subscribe · profile (language, payout wallet).

**FixAm Pro (serviceman):** my assigned jobs (`scope=serviceman`) · job detail (en route, start/complete with codes, landmark, call the customer) · profile.

## Design notes for Sierra Leone

- Touch targets are at least 56 px, body text 17 px, and codes 56 px with spacing. Contrast is high and words are short.
- Money always comes from minor units through `formatLe()` and shows as `Le 1,250`.
- On slow 2G/3G: requests time out after 30 s (2 minutes for uploads), GETs retry once, and lists are cached and shown offline with a "saved data from 10:32" banner. Images are emoji (no image downloads). Badge photos are compressed (JPEG quality 0.6).
- Payments are retry-safe. `PaymentSession` keeps one Idempotency-Key per attempt, reuses it on timeouts and 5xx errors and even after an app restart (stored in AsyncStorage), resumes a payment that is already waiting (`409 payment_in_progress`), and starts a new key only after a definitive failure or a change of wallet.
- Addresses are landmark-first, and the landmark is the most prominent line on the job screen.
- The Krio strings in `packages/shared/src/i18n/kri.ts` were drafted without a native speaker and **need review** before launch. Every English key must exist in Krio; the type system enforces this.
