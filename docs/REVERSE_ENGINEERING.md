# Demandium teardown → FixAm Salone

## How this was done, and its limits

The target was the Demandium live-demo page (`demandium.app/on-demand-home-service-app-project-live-demo/`), 6amTech's on-demand home service product sold on CodeCanyon.

**This build environment's network policy blocked `demandium.app`.** The page, its demo apps and its admin panel could not be loaded, captured or inspected. The feature map below was rebuilt from:

- public marketplace listings (GetApp / Capterra),
- the vendor's CodeCanyon Q&A threads,
- 6amTech's release-note pages,
- general knowledge of the product line.

Each item is labelled:

- **Listed**: stated in a public listing, release note or vendor reply found during research.
- **Inferred**: standard for this product family, but not confirmed from a source in this session.

To upgrade the inferred rows to observed ones, add `demandium.app` to the environment's allowed domains and walk the demo panels. No Demandium code was copied. FixAm is an independent implementation of a comparable feature set.

Sources consulted: [Capterra listing](https://www.capterra.co.uk/software/1313619/Demandium), [GetApp listing](https://www.getapp.co.uk/software/2369787/demandium), CodeCanyon comment threads ([1](https://codecanyon.net/comments/31436850), [2](https://codecanyon.net/comments/31468988), [3](https://codecanyon.net/comments/31653649)), [6amTech v2.1 notes](https://6amtech.com/?p=19783).

## Product surface

| Demandium module | Evidence | FixAm equivalent |
|---|---|---|
| Customer app (Flutter, Android/iOS) | Listed | `mobile/apps/customer` (Expo / React Native) |
| Customer website | Listed | Not built. The Expo app can target web later; see "Gaps". |
| Provider app | Listed | `mobile/apps/pro` (provider role) |
| Serviceman app | Listed | `mobile/apps/pro` (serviceman role, same binary) |
| Provider web panel | Listed | `web/` → `/provider` |
| Admin panel (Laravel) | Listed | `web/` → `/admin` |
| Backend (Laravel + MySQL) | Listed | `backend/` (Node.js/TypeScript + PostgreSQL) |

## Feature map

| Area | Demandium | Evidence | FixAm (this repo) |
|---|---|---|---|
| Service areas | Zone-based coverage. A vendor reply says zones and provider assignment are manual, with no automatic nearest-provider matching. | Listed | Zones as centre + radius, with GPS resolution (`/zones/resolve`). Jobs broadcast to every active provider in the zone who offers the service; the first to accept wins. Direct booking with a chosen provider is also supported. |
| Catalog | Categories, sub-categories, services with variations | Listed / Inferred | Category tree plus services with fixed, hourly or per-unit pricing. Providers can override the price. |
| Booking lifecycle | Pending → accepted → ongoing → completed / cancelled, with serviceman assignment | Inferred | `pending → accepted → assigned → en_route → in_progress → completed`, plus `cancelled` and `disputed`, with a full event log. |
| Job verification | "Confirmation OTP for Complete Service" (v2.1) | Listed | **Two** codes: a start code given on arrival and a completion code given when the customer is satisfied. Both are HMAC-derived and never stored in plain text. |
| Business model | Per-provider **commission or subscription**. Subscription sets a fee, validity and listing limit; services are hidden while the subscription is expired. | Listed | Three plan models (commission / subscription / hybrid), category rates, volume tiers, negotiated overrides, a lower rate on peak surcharge, minimum and maximum commission, and GST on commission. Expired subscriptions fall back to pay-per-job rather than hiding the provider. |
| Payments | Many international gateways, cash after service, offline payment, wallet, partial wallet payment | Listed / Inferred | **Mobile money first**: Orange Money, Afrimoney, QMoney and Monime adapters behind one interface, with a sandbox, idempotency keys, signed webhooks and reconciliation. Also the FixAm wallet and cash after the job. |
| Cash handling | "Cash in hand" limit for providers | Inferred | Cash jobs debit the commission from the provider. Above `cash.max_commission_due_minor`, the provider can't accept jobs until they settle by mobile money. |
| Provider payouts | Withdrawal requests approved by admin | Inferred | Requests hold the funds immediately. Approval pays through the operator API where one exists; otherwise finance pays manually and records the reference. Rejections reverse the hold. |
| Wallet, loyalty, referral | Wallet top-up and partial wallet payment (v2.1); loyalty and referral listed, but some vendor replies call them roadmap items | Listed (conflicting) | Wallet: top-up, pay, refunds land in the wallet. Loyalty and referral are **not built**. |
| Bidding / custom requests | "Smart bidding system" appears in a listing; unconfirmed | Listed (unconfirmed) | **Not built.** FixAm uses transparent rule-based pricing instead (see the peak-hour pricing design). |
| Dynamic pricing | No evidence of peak-hour pricing | Not found | **New**: a time-window, holiday, seasonal, demand and urgency rule engine with guardrails, price locks and a day curve. |
| Provider trust | Provider approval by admin; reviews and ratings | Inferred | **New**: verification badges (ID, police clearance, trade certificate, business registration) with document review, expiry and revocation. Performance badges (top rated, reliable, 100 jobs) are automatic. A trust score feeds ranking. A **public badge-code check** works on the app and on USSD. |
| Notifications | Push (Firebase), SMS OTP gateways, email | Inferred | SMS outbox for every event (OTP, accepted, codes, payments, payouts). Push is a gap. |
| Chat | Customer ↔ provider ↔ admin chat | Inferred | Not built. Contact details unlock on acceptance, plus SMS. |
| Promotions | Coupons, campaigns, banners | Inferred | Not built. `bookings.discount_minor` and commission-on-net already account for discounts. |
| Reviews | Ratings and reviews | Inferred | One review per completed booking. Recomputes the rating and performance badges. |
| Admin reports | Dashboard, transaction reports | Inferred | Dashboard: GMV, commission, GST, peak revenue, cash vs digital, USSD share, by zone, category and method, outstanding cash commission. Audit log and SMS log. |
| Staff roles | Employee roles and permissions | Inferred | A single `admin` role. Fine-grained RBAC is a gap. |
| Languages | Multi-language | Listed | English and Krio (USSD and the apps). Krio needs native-speaker review. |
| Feature phones | n/a | n/a | **New**: a USSD booking channel (book, check status, verify a badge, switch language). |

## What changed for Sierra Leone, and why

1. **Mobile money, not cards.** Card use is low. Orange Money and Africell's Afrimoney dominate, QMoney is smaller, and Monime aggregates across networks. Every wallet is tied to a SIM network, so the API checks the number's prefix against the chosen wallet and suggests the right one.
2. **Unreliable connectivity.** Every payment call needs an `Idempotency-Key`, so retrying after a 2G/3G timeout can never double-charge. Webhooks are de-duplicated and late events cannot reverse a final state. A reconciliation job covers missing callbacks.
3. **Feature phones.** USSD lets someone with a basic handset book a fixer, pay and check a handyman's badge.
4. **Trust and safety.** Letting a stranger into your home is the main barrier. Verification badges have codes the customer can check publicly (USSD menu 3). Start and completion codes prove the visit and the sign-off. Contact details stay hidden on open requests.
5. **Landmark addressing.** Most homes have no formal address, so `area` + `landmark` is required and GPS is optional.
6. **Cash is still common.** Cash jobs are first class. Commission is debited from the provider and capped by an owed-commission limit, and the provider settles by mobile money.
7. **Local pricing reality.** Evening and Saturday demand, night call-outs, holiday rates (Independence Day, Christmas/New Year), rainy-season roofing and plumbing, and hot-season AC/fridge work. Prices are always capped and locked for 15 minutes once quoted.
8. **Tax.** 15% GST on the platform's commission, recorded in a separate tax ledger account so it can be remitted to the NRA.
9. **Currency.** The redenominated Leone (SLE). Stored in minor units and shown rounded to whole Leones.

## Gaps against the full Demandium feature set (backlog)

- Customer website (the Expo app has a web target; or a light Next.js site).
- Push notifications (FCM) alongside SMS.
- In-app chat, or masked calling.
- Coupons, campaigns, banners, loyalty points and referrals.
- Bidding / custom quote requests for jobs that can't be priced up front.
- Repeat or recurring bookings.
- Admin staff roles and permissions.
- Map-based zone drawing (polygons) instead of circles.
