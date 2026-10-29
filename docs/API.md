# FixAm API reference (v1)

Base URL: `http://localhost:4000/api/v1`. JSON everywhere except where noted. Auth uses `Authorization: Bearer <accessToken>`.

**Conventions**
- Money is integer **minor units of the new Leone (SLE)**: `25000` = Le 250.00. Display with `Le {amount/100}`.
- Phone numbers are accepted in any local form (`076 123 456`, `+23276123456`) and returned in E.164 (`+23276123456`).
- Timestamps are ISO-8601 UTC. Sierra Leone (Africa/Freetown) is UTC+0 all year.
- Errors: `{ "error": { "code": "snake_case", "message": "Human readable", "details": {...} } }` with 4xx/5xx status.
- Lists accept `limit` (≤200, default 50) and `offset`.
- Response rows use the database's snake_case column names; request bodies use camelCase.

Roles: `customer`, `provider` (owner of a provider business), `serviceman` (team member of a provider), `admin`.

---

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/otp/request` | `{ phone }` | Sends a 6-digit SMS code. Outside production, the response includes `devCode`. Max 3 codes per 10 min. |
| POST | `/auth/otp/verify` | `{ phone, code, name?, language?: 'en'\|'kri' }` | Returns `{ accessToken, refreshToken, expiresIn, isNewUser, user }`. Creates a customer account on first login. |
| POST | `/auth/login` | `{ phone, password }` | Password login (admin panel). Same response shape. |
| POST | `/auth/refresh` | `{ refreshToken }` | Rotates tokens. |
| POST | `/auth/logout` | `{ refreshToken }` | |
| GET | `/auth/me` | | `{ id, phone, name, email, role, language, phone_verified_at, provider_id, serviceman_id }` |
| PATCH | `/auth/me` | `{ name?, email?, language? }` | |

## Zones & catalog

| Method | Path | Notes |
|---|---|---|
| GET | `/zones` | Active service zones (Freetown areas, Bo, Kenema, Makeni, …). Admins can add `?includeInactive=true`. |
| GET | `/zones/resolve?lat=&lng=` | Zone covering a GPS point (404 when outside every zone). |
| POST/PATCH | `/zones`, `/zones/:id` | Admin. `{ name, district, city, centerLat, centerLng, radiusKm, active? }` |
| GET | `/catalog/categories` | Category tree `[{ id, slug, name, icon, service_count, children: [] }]`. Admins can add `?includeInactive=true` (also on `/catalog/services`). |
| GET | `/catalog/services?categoryId=&zoneId=&q=` | With `zoneId`, only services some active provider offers in that zone. |
| GET | `/catalog/services/:id` | |
| POST/PATCH | `/catalog/categories[/:id]`, `/catalog/services[/:id]` | Admin. Category PATCH accepts `parentId` (`null` = top level). Service: `{ categoryId, name, description?, basePriceMinor, priceUnit: fixed\|hourly\|per_unit, unitLabel?, durationMinutes }` |

## Peak-hour pricing

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/pricing/quote` | `{ serviceId, zoneId, scheduledAt?, quantity?, isEmergency?, providerId? }` | Auth optional. **Locks the price for 15 minutes.** Returns a quote row: `{ id, subtotal_minor, surcharge_minor, total_minor, multiplier, breakdown: { unitPriceMinor, demandRatio, appliedRules: [{ id, label, kind, multiplier, flatFeeMinor, stacked }], cappedBy, lines: [{ label, amountMinor }] }, expires_at }` |
| GET | `/pricing/day-curve?serviceId=&zoneId=&date=YYYY-MM-DD&providerId=&isEmergency=` | | Hour-by-hour price from 06:00 to 22:00. Each hour has `bookable` (at least 1 h ahead) and `isCheapest` (cheapest among bookable hours). Lets the app say "book at 10:00 and save". |
| GET | `/pricing/rules` | | Admin: every rule, active or not. |
| POST | `/pricing/rules` | `{ name, label, kind, zoneId?, categoryId?, daysOfWeek?: [0-6], startTime?: 'HH:MM', endTime?, dateFrom?, dateTo?, recurringYearly?, minDemandRatio?, multiplier, flatFeeMinor?, stackable?, priority?, active? }` | Admin. `kind`: `time_window` \| `holiday` \| `seasonal` \| `demand` \| `emergency`. |
| PATCH/DELETE | `/pricing/rules/:id` | | Admin. Sending `null` on PATCH clears a field. |
| POST | `/pricing/simulate` | `{ unitPriceMinor, quantity, zoneId, categoryIds, scheduledAt, isEmergency, demandRatio }` | Admin dry run of the current rules. |

How rules combine:
1. The matching non-stackable rule with the highest `priority` wins; a tie goes to the higher multiplier.
2. Matching stackable rules (urgent, high demand) multiply on top of it and add their flat fees.
3. The combined multiplier is capped at the `pricing.max_multiplier` setting (default 1.75×), then the surcharge at `pricing.max_surcharge_minor`.
4. Customer prices are rounded to whole Leones.

Time windows can wrap midnight. A Friday 21:00–06:00 window also matches Saturday 02:00.

## Providers

| Method | Path | Notes |
|---|---|---|
| POST | `/providers/register` | Logged-in customer becomes a provider (status `pending` until an admin approves). `{ businessName, kind: individual\|company, bio?, zoneIds[], services: [{ serviceId, priceOverrideMinor? }], payoutGateway?, payoutMsisdn? }`. Grants the `PHONE_VERIFIED` badge. |
| GET | `/providers?zoneId=&serviceId=&badge=` | Public search, ranked by availability, trust score (from badges), then rating. Each row has `badges: ['NATIONAL_ID', …]` and `price_override_minor`. |
| GET | `/providers/:id` | Public profile: badges (with `verification_code`), services with prices, zones. |
| GET | `/providers/me` | Full provider dashboard payload: zones, services, badges, `commission_plan`, `active_subscription`, `balance_minor`, `commission_owed_minor`, `cash_commission_limit_minor`, `can_accept_jobs`, `accept_blockers` (e.g. `missing_badge:NATIONAL_ID`, `cash_commission_limit_exceeded`, `provider_pending`). |
| PATCH | `/providers/me` | `{ businessName?, bio?, isAvailable?, payoutGateway?, payoutMsisdn? }` |
| PUT | `/providers/me/zones` | `{ zoneIds[] }` |
| PUT | `/providers/me/services` | `{ services: [{ serviceId, priceOverrideMinor? }] }` |
| GET | `/providers/me/commission-preview?serviceId=&subtotalMinor=&surchargeMinor=` | What the provider keeps from a job under their current plan. |
| GET | `/providers/me/subscriptions` | |
| PUT | `/providers/me/plan` | `{ planId }`. Switch to a pay-per-job plan. Subscription plans start only when paid for. |
| GET/POST | `/providers/me/servicemen` | POST `{ name, phone }` adds a team member, who then logs in with OTP and has role `serviceman`. |
| PATCH | `/providers/me/servicemen/:id` | `{ active }` |
| POST | `/providers/:id/status` | Admin: `{ status: active\|suspended\|pending, note? }` |

## Bookings

Lifecycle: `pending → accepted → (assigned) → en_route → in_progress → completed`. `cancelled` is possible before work starts; `disputed` covers in-progress or completed jobs.

| Method | Path | Body | Who |
|---|---|---|---|
| POST | `/bookings` | `{ quoteId, address: { area, landmark, street?, lat?, lng?, contactPhone? }, notes?, paymentMethod: cash\|wallet\|orange_money\|afrimoney\|qmoney\|monime }` | customer |
| GET | `/bookings?scope=customer\|provider\|serviceman\|requests\|all&status=` | | `requests` = open jobs a provider can accept (in their zones, for their services). `all` = admin. |
| GET | `/bookings/:id` | | Includes `events[]` and `price_breakdown`. The customer also sees `start_code`, and `completion_code` once work is in progress. Providers looking at an open request see only area and landmark, not the customer's phone. |
| POST | `/bookings/:id/accept` | | provider. First provider wins; 409 `already_taken` after that. Blocked by `accept_blockers`. |
| POST | `/bookings/:id/assign` | `{ servicemanId }` | provider |
| POST | `/bookings/:id/en-route` | | provider or assigned serviceman |
| POST | `/bookings/:id/start` | `{ code }` | 4-digit start code the customer gives on arrival |
| POST | `/bookings/:id/complete` | `{ code }` | 4-digit completion code. Triggers commission settlement. |
| POST | `/bookings/:id/cancel` | `{ reason }` | customer, provider or admin. Refunds prepayment to the customer's wallet. If a provider withdraws from a broadcast job, it goes back to `pending`. |
| POST | `/bookings/:id/dispute` | `{ reason }` | customer, up to 72 h after completion |
| POST | `/bookings/:id/resolve` | `{ resolution: release\|refund, note }` | admin. `refund` reverses the settlement ledger entries. |
| POST | `/reviews` | `{ bookingId, rating: 1-5, comment? }` | customer, completed jobs only |
| GET | `/reviews/provider/:providerId` | | public |

## Mobile money payments

| Method | Path | Notes |
|---|---|---|
| GET | `/payments/methods?msisdn=` | Lists available methods. With `msisdn`, returns the detected `operator` (`orange`, `africell`, `qcell`) and the `suggested` wallet. |
| POST | `/payments` | **Requires an `Idempotency-Key` header** (8–100 chars; retry with the same key after a timeout). The body is one of the shapes below. The server computes the amount for everything except top-ups. |
| GET | `/payments` | Your payments (admin: all, `?status=`). |
| GET | `/payments/:id` | **Poll this** while the payer approves on their phone. It also checks the gateway if no callback has arrived. |
| POST | `/payments/:id/simulate` | Sandbox only: `{ outcome?: succeeded\|failed }`. Sends a correctly signed operator webhook through the real handler. |
| POST | `/webhooks/payments/:gateway` | Operator callbacks (raw body). Sandbox and template gateways verify the `x-fixam-signature: t=<unix>,v1=<hmac-sha256 hex of "t.body">` header. Duplicates are ignored. |
| GET | `/payments/admin/webhook-events` | Admin audit of every callback received. |

`POST /payments` bodies:
```jsonc
{ "purpose": "booking", "bookingId": "…", "gateway": "orange_money|afrimoney|qmoney|monime|wallet", "msisdn": "076123456" }
{ "purpose": "wallet_topup", "amountMinor": 50000, "gateway": "afrimoney", "msisdn": "077123456" }
{ "purpose": "subscription", "planId": "…", "gateway": "orange_money", "msisdn": "…" }       // provider
{ "purpose": "cash_settlement", "amountMinor": 12000, "gateway": "qmoney", "msisdn": "…" }   // provider pays commission owed on cash jobs
```
Response: a payment `{ id, status: initiated|pending|succeeded|failed|expired|refunded, gateway, msisdn, amount_minor, customer_action: { type: approve_on_phone|dial_ussd|redirect, message, ussdCode?, paymentCode?, redirectUrl? }, failure_reason, expires_at }`.

Wallet-network check: an Orange Money charge to an Africell number is rejected with `400 wallet_network_mismatch`, and `details.suggestedGateway` names the right wallet.

**Sandbox test numbers** (last 3 digits): `…000` declines (insufficient funds), `…999` never approves (expires after 15 min), anything else approves after about 8 s, or immediately via `/simulate`.

## Wallet, earnings & payouts

| Method | Path | Notes |
|---|---|---|
| GET | `/wallet` | Customer: `{ balance_minor, entries[] }`. Provider: `{ balance_minor, available_minor, commission_owed_minor, cash_commission_limit_minor, payout_min_minor, payout_fee_minor, pending_payouts[], entries[] }`. Entries carry `entry_type` and `running_balance_minor`. |
| POST | `/wallet/payouts` | Provider: `{ amountMinor }` withdraws to the payout mobile money number. The money is held immediately. |
| GET | `/wallet/payouts?status=` | Provider: own payouts. Admin: all. |
| POST | `/wallet/payouts/:id/approve` | Admin. Sends the payout through the operator API. If that operator has no payout API, the payout stays `approved` for manual payment. |
| POST | `/wallet/payouts/:id/mark-paid` | Admin: `{ externalRef }` after paying from the operator portal. |
| POST | `/wallet/payouts/:id/reject` | Admin: `{ reason }`. Returns the money to the provider's balance. |

## Commission

| Method | Path | Notes |
|---|---|---|
| GET | `/commission/plans` | Public list of active plans with `category_rates`. |
| GET | `/commission/plans/all` | Admin. |
| POST/PATCH | `/commission/plans[/:id]` | Admin: `{ code, name, model: commission\|subscription\|hybrid, defaultRateBps, subscriptionRateBps, surchargeRateBps?, minCommissionMinor, maxCommissionMinor?, subscriptionFeeMinor, subscriptionPeriodDays, tiers: [{ min_gmv_minor, rate_bps }], isDefault?, active? }` |
| PUT | `/commission/plans/:id/category-rates` | Admin: `{ rates: [{ categoryId, rateBps }] }` |
| PATCH | `/commission/providers/:providerId` | Admin: `{ planId?, overrideBps?: number\|null }` |
| POST | `/commission/simulate` | Admin calculator. |

The rate for a job is resolved in this order:
1. The provider's negotiated override.
2. The plan's subscription rate, while the subscription is paid up (subscription and hybrid plans only).
3. The plan's rate for the job's category.
4. The volume tier for the provider's completed GMV over the last 30 days.
5. The plan's default rate.

The peak surcharge can carry its own lower rate (`surcharge_rate_bps`), so providers keep most of the extra they earn for peak-hour work. GST (15%, `commission.gst_rate_bps`) applies to the commission. By default the provider bears it (`commission.gst_borne_by = provider`).

How a job settles:
- **Mobile money or wallet:** the platform holds the money and credits the provider's earning.
- **Cash:** the provider holds the money and is debited the platform's share. A negative balance means commission is owed. Above `cash.max_commission_due_minor` (Le 2,000 by default), the provider can't accept jobs until they pay through `purpose: cash_settlement`.

## Badges

| Method | Path | Notes |
|---|---|---|
| GET | `/badges/definitions` | `PHONE_VERIFIED`, `NATIONAL_ID`, `POLICE_CLEARANCE`, `TRADE_CERTIFIED`, `BUSINESS_REGISTERED` (verification), `TOP_RATED`, `RELIABLE`, `VETERAN` (performance). Each has `required_documents`, `validity_days`, `criteria`, `trust_weight`. |
| GET | `/badges/verify/:code` | **Public.** A customer checks the code on a handyman's badge (`FXB-XXXXXX`) before letting them in. Returns `{ valid, reason, badge, provider, ownerName, rating, completedJobs, issuedAt, expiresAt }`. |
| GET | `/badges/mine` | Provider: own badges and their statuses. |
| POST | `/badges/apply` | Provider: `{ badgeCode, documents: [{ type, url, number? }] }`. Document types must cover `required_documents`. Renewing within 30 days of expiry keeps the current badge valid until the renewal is approved. |
| GET | `/badges/applications?status=pending` | Admin review queue. |
| POST | `/badges/applications/:id/review` | Admin: `{ decision: approve\|reject, note? }`. A note is required for a rejection. The provider gets an SMS. |
| POST | `/badges/:id/revoke` | Admin: `{ note }` |

Performance badges are granted and withdrawn automatically after each completion, review and cancellation. Time-limited badges expire through the background job. A provider's trust score is the sum of their valid badges' `trust_weight` and drives search ranking. The `badges.required_to_accept_jobs` setting (default `["NATIONAL_ID"]`) gates accepting jobs.

## Uploads

| Method | Path | Notes |
|---|---|---|
| POST | `/uploads` | Raw body with `Content-Type: image/jpeg\|image/png\|image/webp\|application/pdf`, ≤5 MB. Returns `{ url }`, which goes in badge documents. |
| GET | `/uploads/:name` | Auth. Only the uploader or an admin can read a file. |

## USSD (feature phones)

`POST /ussd`, form-encoded `sessionId, serviceCode, phoneNumber, text`, replies `text/plain` starting `CON ` or `END ` (the common aggregator contract). Menu: book a fixer (trade → job → area → when → price with peak labels → cash or mobile money → landmark), last booking status, check a badge code, switch between English and Krio.

## Admin

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/dashboard?days=30` | Totals (bookings, GMV, peak surcharge, commission, GST, cash vs digital, USSD share), breakdowns by payment method, zone and category, daily series, platform ledger, pending badge reviews and payouts, outstanding cash commission. |
| GET | `/admin/providers?status=&q=` | With `balance_minor`, `pending_badges`, `zones`. |
| GET | `/admin/providers/:id/badges` · `/admin/providers/:id/ledger` | One provider's badges, and their balance and ledger entries. |
| GET | `/admin/users?role=` / POST `/admin/users/:id/status` | `{ status: active\|blocked }` |
| GET/PUT | `/admin/settings` | Keys: `pricing.max_multiplier`, `pricing.max_surcharge_minor`, `pricing.demand_window_hours`, `commission.gst_rate_bps`, `commission.gst_borne_by`, `cash.max_commission_due_minor`, `payout.min_minor`, `payout.fee_minor`, `badges.required_to_accept_jobs`, `payment.strict_operator_match`, `phone_prefixes`. |
| GET | `/admin/sms-outbox` | Every SMS sent. In dev, read OTPs and notifications here. |
| GET | `/admin/audit-logs` | |

## Demo accounts (seeded)

| Role | Phone | Login |
|---|---|---|
| Admin | 076 000 001 | password `Admin@123` |
| Customer | 076 111 111 (Aminata Kamara) | OTP (`devCode` in the response) |
| Provider, electrical (Africell) | 077 222 222 Bright Spark Electrical | OTP |
| Provider, plumbing (Orange, Growth plan) | 076 333 333 Salone Plumbing Works | OTP |
| Serviceman of Salone Plumbing | 078 444 444 Ibrahim Bangura | OTP |
| Provider, solar (Pro subscription) | 076 555 555 PowerUp Solar & Generators | OTP |
| Provider, pending approval (Bo) | 030 555 556 Bo Cool Fridge & AC | OTP |
