-- FixAm Salone schema.
-- Money is stored as integer minor units of the new Leone (SLE): 100 minor = Le 1.00.
-- All timestamps are timestamptz; business rules evaluate them in Africa/Freetown (UTC+0, no DST).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────── Identity ─────────────────────────
CREATE TYPE user_role AS ENUM ('customer', 'provider', 'serviceman', 'admin');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          text NOT NULL UNIQUE,              -- E.164, e.g. +23276123456
  name           text,
  email          text,
  role           user_role NOT NULL DEFAULT 'customer',
  language       text NOT NULL DEFAULT 'en',        -- en | kri
  password_hash  text,                              -- admins only (panel login)
  phone_verified_at timestamptz,
  status         text NOT NULL DEFAULT 'active',    -- active | blocked
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  purpose     text NOT NULL,                        -- login
  code_hash   text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Geography & catalog ─────────────────────────
CREATE TABLE zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,                         -- e.g. "Freetown - East End"
  district   text NOT NULL,                         -- e.g. "Western Area Urban"
  city       text NOT NULL,
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  radius_km  double precision NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid REFERENCES categories(id),
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  name_kri   text,
  icon       text,
  sort_order int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE services (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id       uuid NOT NULL REFERENCES categories(id),
  name              text NOT NULL,
  name_kri          text,
  description       text,
  base_price_minor  bigint NOT NULL CHECK (base_price_minor >= 0),
  price_unit        text NOT NULL DEFAULT 'fixed',  -- fixed | hourly | per_unit
  unit_label        text,                           -- "socket", "hour", "m²"
  duration_minutes  int NOT NULL DEFAULT 60,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Commission plans ─────────────────────────
-- model: commission   -> platform takes a % of every job
--        subscription -> provider pays a periodic fee, commission uses subscription_rate_bps (often 0)
--        hybrid       -> fee + reduced commission
CREATE TABLE commission_plans (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE,
  name                      text NOT NULL,
  model                     text NOT NULL CHECK (model IN ('commission', 'subscription', 'hybrid')),
  default_rate_bps          int NOT NULL CHECK (default_rate_bps BETWEEN 0 AND 10000),
  subscription_rate_bps     int NOT NULL DEFAULT 0 CHECK (subscription_rate_bps BETWEEN 0 AND 10000),
  surcharge_rate_bps        int CHECK (surcharge_rate_bps BETWEEN 0 AND 10000), -- rate on the peak surcharge; NULL = same as job rate
  min_commission_minor      bigint NOT NULL DEFAULT 0,
  max_commission_minor      bigint,
  subscription_fee_minor    bigint NOT NULL DEFAULT 0,
  subscription_period_days  int NOT NULL DEFAULT 30,
  -- volume tiers on trailing-30-day completed GMV: [{"min_gmv_minor": 0, "rate_bps": 1500}, ...]
  tiers                     jsonb NOT NULL DEFAULT '[]',
  is_default                boolean NOT NULL DEFAULT false,
  active                    boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commission_plans_one_default ON commission_plans (is_default) WHERE is_default;

CREATE TABLE commission_category_rates (
  plan_id     uuid NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  rate_bps    int NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  PRIMARY KEY (plan_id, category_id)
);

-- ───────────────────────── Providers ─────────────────────────
CREATE TABLE providers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id          uuid NOT NULL UNIQUE REFERENCES users(id),
  business_name          text NOT NULL,
  kind                   text NOT NULL DEFAULT 'individual', -- individual | company
  bio                    text,
  status                 text NOT NULL DEFAULT 'pending',    -- pending | active | suspended
  commission_plan_id     uuid REFERENCES commission_plans(id),
  commission_override_bps int CHECK (commission_override_bps BETWEEN 0 AND 10000),
  payout_msisdn          text,
  payout_gateway         text,
  is_available           boolean NOT NULL DEFAULT true,
  rating_avg             numeric(3,2) NOT NULL DEFAULT 0,
  rating_count           int NOT NULL DEFAULT 0,
  completed_jobs         int NOT NULL DEFAULT 0,
  cancelled_jobs         int NOT NULL DEFAULT 0,
  trust_score            int NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_zones (
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  zone_id     uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, zone_id)
);

CREATE TABLE provider_services (
  provider_id          uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  service_id           uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  price_override_minor bigint CHECK (price_override_minor >= 0),
  PRIMARY KEY (provider_id, service_id)
);

CREATE TABLE servicemen (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES commission_plans(id),
  status      text NOT NULL DEFAULT 'pending_payment', -- pending_payment | active | expired | cancelled
  starts_at   timestamptz,
  ends_at     timestamptz,
  payment_id  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Peak-hour pricing ─────────────────────────
-- kind: time_window | holiday | seasonal | demand | emergency
CREATE TABLE pricing_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  label           text NOT NULL,                   -- customer-facing, e.g. "Evening peak"
  kind            text NOT NULL CHECK (kind IN ('time_window', 'holiday', 'seasonal', 'demand', 'emergency')),
  zone_id         uuid REFERENCES zones(id) ON DELETE CASCADE,       -- NULL = all zones
  category_id     uuid REFERENCES categories(id) ON DELETE CASCADE,  -- NULL = all categories
  days_of_week    int[],                           -- 0=Sun..6=Sat, NULL = every day
  start_time      time,                            -- local Freetown time; window may wrap midnight
  end_time        time,
  date_from       date,                            -- holiday/seasonal: inclusive date range
  date_to         date,
  recurring_yearly boolean NOT NULL DEFAULT false, -- seasonal/holiday ranges that repeat every year
  min_demand_ratio numeric(6,2),                   -- demand: open requests per available provider
  multiplier      numeric(5,3) NOT NULL DEFAULT 1.000 CHECK (multiplier >= 1 AND multiplier <= 5),
  flat_fee_minor  bigint NOT NULL DEFAULT 0 CHECK (flat_fee_minor >= 0),
  stackable       boolean NOT NULL DEFAULT false,  -- stackable rules multiply on top of the best non-stackable rule
  priority        int NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_quotes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid REFERENCES users(id),
  service_id          uuid NOT NULL REFERENCES services(id),
  provider_id         uuid REFERENCES providers(id),
  zone_id             uuid NOT NULL REFERENCES zones(id),
  scheduled_at        timestamptz NOT NULL,
  is_emergency        boolean NOT NULL DEFAULT false,
  quantity            numeric(10,2) NOT NULL DEFAULT 1,
  subtotal_minor      bigint NOT NULL,
  surcharge_minor     bigint NOT NULL,
  total_minor         bigint NOT NULL,
  multiplier          numeric(5,3) NOT NULL,
  breakdown           jsonb NOT NULL,
  expires_at          timestamptz NOT NULL,
  used_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Bookings ─────────────────────────
CREATE TABLE bookings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text NOT NULL UNIQUE,              -- e.g. FX-7K2P9Q, readable on USSD/SMS
  customer_id            uuid NOT NULL REFERENCES users(id),
  provider_id            uuid REFERENCES providers(id),
  serviceman_id          uuid REFERENCES servicemen(id),
  service_id             uuid NOT NULL REFERENCES services(id),
  zone_id                uuid NOT NULL REFERENCES zones(id),
  quote_id               uuid NOT NULL UNIQUE REFERENCES price_quotes(id),
  channel                text NOT NULL DEFAULT 'app',       -- app | web | ussd
  status                 text NOT NULL DEFAULT 'pending',
  -- address: { area, landmark, street?, lat?, lng?, contact_phone }  (landmark-based addressing)
  address                jsonb NOT NULL,
  notes                  text,
  scheduled_at           timestamptz NOT NULL,
  is_emergency           boolean NOT NULL DEFAULT false,
  payment_method         text NOT NULL,                     -- cash | wallet | orange_money | afrimoney | qmoney | monime
  payment_status         text NOT NULL DEFAULT 'unpaid',    -- unpaid | pending | paid | refunded
  subtotal_minor         bigint NOT NULL,
  surcharge_minor        bigint NOT NULL,
  discount_minor         bigint NOT NULL DEFAULT 0,
  total_minor            bigint NOT NULL,
  commission_minor       bigint,
  commission_gst_minor   bigint,
  provider_earning_minor bigint,
  commission_snapshot    jsonb,
  dispute_reason         text,
  disputed_at            timestamptz,
  settled_at             timestamptz,
  accepted_at            timestamptz,
  started_at             timestamptz,
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  cancel_reason          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_status_chk CHECK (status IN
    ('pending', 'accepted', 'assigned', 'en_route', 'in_progress', 'completed', 'cancelled', 'disputed'))
);
CREATE INDEX bookings_zone_status_idx ON bookings (zone_id, status);
CREATE INDEX bookings_provider_idx ON bookings (provider_id, created_at DESC);
CREATE INDEX bookings_customer_idx ON bookings (customer_id, created_at DESC);

CREATE TABLE booking_events (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor_id    uuid REFERENCES users(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES bookings(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Payments (mobile money) ─────────────────────────
CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  purpose          text NOT NULL CHECK (purpose IN ('booking', 'wallet_topup', 'subscription', 'cash_settlement')),
  booking_id       uuid REFERENCES bookings(id),
  subscription_id  uuid REFERENCES provider_subscriptions(id),
  provider_id      uuid REFERENCES providers(id),            -- for cash_settlement / subscription
  gateway          text NOT NULL,                            -- orange_money | afrimoney | qmoney | monime | wallet
  msisdn           text,
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
  currency         text NOT NULL DEFAULT 'SLE',
  status           text NOT NULL DEFAULT 'initiated',        -- initiated | pending | succeeded | failed | expired | refunded
  idempotency_key  text NOT NULL,
  external_ref     text,
  customer_action  jsonb,                                    -- what the payer must do (USSD prompt, OTP, payment code)
  failure_reason   text,
  gateway_payload  jsonb,
  expires_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX payments_gateway_ref_idx ON payments (gateway, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX payments_status_idx ON payments (status, created_at);

CREATE TABLE payment_webhook_events (
  id             bigserial PRIMARY KEY,
  gateway        text NOT NULL,
  event_id       text NOT NULL,
  signature_ok   boolean NOT NULL,
  payload        jsonb NOT NULL,
  processed_at   timestamptz,
  result         text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, event_id)
);

CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES providers(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor     bigint NOT NULL DEFAULT 0,
  gateway       text NOT NULL,
  msisdn        text NOT NULL,
  status        text NOT NULL DEFAULT 'requested',   -- requested | approved | processing | paid | failed | rejected
  external_ref  text,
  failure_reason text,
  reviewed_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

-- ───────────────────────── Ledger ─────────────────────────
-- Signed entries per account. Balance = SUM(amount_minor).
-- account_type: provider (earnings wallet), customer (wallet), platform_revenue, platform_tax (GST payable)
CREATE TABLE ledger_entries (
  id            bigserial PRIMARY KEY,
  account_type  text NOT NULL,
  account_id    uuid,                                  -- provider id / user id; NULL for platform accounts
  entry_type    text NOT NULL,                         -- job_earning | commission | commission_gst | cash_commission_due | payout | topup | booking_payment | refund | subscription_fee | cash_settlement
  amount_minor  bigint NOT NULL,
  booking_id    uuid REFERENCES bookings(id),
  payment_id    uuid REFERENCES payments(id),
  payout_id     uuid REFERENCES payouts(id),
  memo          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_account_idx ON ledger_entries (account_type, account_id);
-- A booking can only be settled once per entry type and account.
CREATE UNIQUE INDEX ledger_booking_once ON ledger_entries (booking_id, account_type, entry_type)
  WHERE booking_id IS NOT NULL AND entry_type IN ('job_earning', 'commission', 'commission_gst', 'cash_commission_due', 'booking_payment', 'refund');

-- ───────────────────────── Badges ─────────────────────────
CREATE TABLE badge_definitions (
  code              text PRIMARY KEY,
  name              text NOT NULL,
  description       text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('verification', 'performance')),
  required_documents text[] NOT NULL DEFAULT '{}',
  validity_days     int,                             -- NULL = no expiry
  criteria          jsonb,                           -- performance thresholds
  trust_weight      int NOT NULL DEFAULT 0,
  icon              text,
  sort_order        int NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true
);

CREATE TABLE provider_badges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  badge_code        text NOT NULL REFERENCES badge_definitions(code),
  status            text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | revoked | expired
  documents         jsonb NOT NULL DEFAULT '[]',      -- [{type, url, number?}]
  verification_code text NOT NULL UNIQUE,            -- public lookup code printed on ID card / QR
  reviewer_id       uuid REFERENCES users(id),
  review_note       text,
  issued_at         timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Only one live (pending/approved) record per provider and badge.
CREATE UNIQUE INDEX provider_badges_live_idx ON provider_badges (provider_id, badge_code)
  WHERE status IN ('pending', 'approved');

-- ───────────────────────── Platform plumbing ─────────────────────────
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sms_outbox (
  id         bigserial PRIMARY KEY,
  phone      text NOT NULL,
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'queued',
  provider   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);

CREATE TABLE ussd_sessions (
  session_id text PRIMARY KEY,
  phone      text NOT NULL,
  state      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  data       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
