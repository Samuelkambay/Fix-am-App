// Entity types for the FixAm API (v1). Response rows use the database's snake_case column names;
// request bodies use camelCase. Money is always integer minor units of the new Leone (100 minor = Le 1).
// Ground truth: backend/src/modules/*/*.routes.ts.

export type Role = 'customer' | 'provider' | 'serviceman' | 'admin';
export type Language = 'en' | 'kri';
export type Operator = 'orange' | 'africell' | 'qcell' | 'unknown';
export type GatewayCode = 'orange_money' | 'afrimoney' | 'qmoney' | 'monime';
export type PaymentMethod = 'cash' | 'wallet' | GatewayCode;
export type ISODate = string;

// ───────── Auth ─────────
export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  role: Role;
  language: Language;
  phone_verified_at: ISODate | null;
  provider_id: string | null;
  serviceman_id: string | null;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface OtpRequestResult {
  sent: boolean;
  phone: string;
  expiresIn: number;
  /** Only outside production. */
  devCode?: string;
}

export interface LoginResult extends Tokens {
  isNewUser?: boolean;
  user: User;
}

// ───────── Zones & catalog ─────────
export interface Zone {
  id: string;
  name: string;
  district: string;
  city: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  active: boolean;
  distance_km?: number;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  name_kri: string | null;
  icon: string | null;
  parent_id: string | null;
  sort_order: number;
  service_count: number;
  children: Category[];
}

export type PriceUnit = 'fixed' | 'hourly' | 'per_unit';

export interface Service {
  id: string;
  category_id: string;
  name: string;
  name_kri: string | null;
  description: string | null;
  base_price_minor: number;
  price_unit: PriceUnit;
  unit_label: string | null;
  duration_minutes: number;
  active: boolean;
  category_name?: string;
  category_slug?: string;
}

// ───────── Pricing ─────────
export type RuleKind = 'time_window' | 'holiday' | 'seasonal' | 'demand' | 'emergency';

export interface AppliedRule {
  id: string;
  label: string;
  kind: RuleKind;
  multiplier: number;
  flatFeeMinor: number;
  stacked: boolean;
}

export interface PriceBreakdown {
  unitPriceMinor: number;
  demandRatio: number;
  appliedRules: AppliedRule[];
  cappedBy: 'max_multiplier' | 'max_surcharge' | null;
  lines: { label: string; amountMinor: number }[];
}

export interface Quote {
  id: string;
  customer_id: string | null;
  service_id: string;
  provider_id: string | null;
  zone_id: string;
  scheduled_at: ISODate;
  is_emergency: boolean;
  quantity: number;
  subtotal_minor: number;
  surcharge_minor: number;
  total_minor: number;
  multiplier: number;
  breakdown: PriceBreakdown;
  expires_at: ISODate;
  used_at: ISODate | null;
  created_at: ISODate;
}

export interface QuoteRequest {
  serviceId: string;
  zoneId: string;
  scheduledAt?: string;
  quantity?: number;
  isEmergency?: boolean;
  providerId?: string;
}

export interface DayCurveHour {
  at: ISODate;
  hour: number;
  totalMinor: number;
  surchargeMinor: number;
  multiplier: number;
  labels: string[];
  isCheapest: boolean;
}

export interface DayCurve {
  date: string;
  hours: DayCurveHour[];
}

// ───────── Providers ─────────
export type BadgeCode =
  | 'PHONE_VERIFIED'
  | 'NATIONAL_ID'
  | 'POLICE_CLEARANCE'
  | 'TRADE_CERTIFIED'
  | 'BUSINESS_REGISTERED'
  | 'TOP_RATED'
  | 'RELIABLE'
  | 'VETERAN'
  | (string & {});

export interface ProviderSummary {
  id: string;
  business_name: string;
  kind: 'individual' | 'company';
  bio: string | null;
  rating_avg: number;
  rating_count: number;
  completed_jobs: number;
  trust_score: number;
  is_available: boolean;
  price_override_minor: number | null;
  badges: BadgeCode[];
}

export interface PublicBadge {
  code: BadgeCode;
  name: string;
  kind: 'verification' | 'performance';
  icon: string | null;
  verification_code: string;
  issued_at: ISODate | null;
  expires_at: ISODate | null;
}

export interface ProviderProfile {
  id: string;
  business_name: string;
  kind: 'individual' | 'company';
  bio: string | null;
  rating_avg: number;
  rating_count: number;
  completed_jobs: number;
  trust_score: number;
  is_available: boolean;
  created_at: ISODate;
  badges: PublicBadge[];
  badge_codes: BadgeCode[];
  services: { id: string; name: string; price_minor: number; price_unit: PriceUnit; unit_label: string | null }[];
  zones: { id: string; name: string }[];
}

export type BadgeStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked';

export interface ProviderBadge {
  id: string;
  badge_code: BadgeCode;
  status: BadgeStatus;
  verification_code: string;
  review_note: string | null;
  issued_at: ISODate | null;
  expires_at: ISODate | null;
  created_at: ISODate;
  name: string;
  kind: 'verification' | 'performance';
  icon: string | null;
  description: string | null;
}

export interface CommissionPlan {
  id: string;
  code: string;
  name: string;
  model: 'commission' | 'subscription' | 'hybrid';
  default_rate_bps: number;
  subscription_rate_bps: number;
  surcharge_rate_bps: number | null;
  min_commission_minor: number;
  max_commission_minor: number | null;
  subscription_fee_minor: number;
  subscription_period_days: number;
  tiers: { min_gmv_minor: number; rate_bps: number }[];
  is_default: boolean;
  active: boolean;
  category_rates?: { plan_id: string; category_id: string; rate_bps: number; category_name: string }[];
}

export interface Subscription {
  id: string;
  provider_id: string;
  plan_id: string;
  status: 'pending' | 'active' | 'expired' | 'cancelled' | (string & {});
  starts_at: ISODate | null;
  ends_at: ISODate | null;
  payment_id: string | null;
  created_at: ISODate;
  plan_name?: string;
  subscription_fee_minor?: number;
}

export type ProviderStatus = 'pending' | 'active' | 'suspended';

export interface ProviderMe {
  id: string;
  owner_user_id: string;
  business_name: string;
  kind: 'individual' | 'company';
  bio: string | null;
  status: ProviderStatus;
  commission_plan_id: string | null;
  commission_override_bps: number | null;
  payout_msisdn: string | null;
  payout_gateway: GatewayCode | null;
  is_available: boolean;
  rating_avg: number;
  rating_count: number;
  completed_jobs: number;
  cancelled_jobs: number;
  trust_score: number;
  created_at: ISODate;
  zones: Zone[];
  services: { id: string; name: string; base_price_minor: number; price_override_minor: number | null; category_name: string }[];
  badges: ProviderBadge[];
  commission_plan: CommissionPlan;
  active_subscription: Subscription | null;
  balance_minor: number;
  commission_owed_minor: number;
  cash_commission_limit_minor: number;
  can_accept_jobs: boolean;
  /** e.g. `missing_badge:NATIONAL_ID`, `cash_commission_limit_exceeded`, `provider_pending`. */
  accept_blockers: string[];
}

export interface ProviderRegistration {
  businessName: string;
  kind: 'individual' | 'company';
  bio?: string;
  zoneIds: string[];
  services: { serviceId: string; priceOverrideMinor?: number | null }[];
  payoutGateway?: GatewayCode;
  payoutMsisdn?: string;
}

export interface CommissionPreview {
  totalMinor: number;
  rateBps: number;
  rateSource: 'provider_override' | 'subscription' | 'category' | 'volume_tier' | 'plan_default';
  surchargeRateBps: number;
  commissionMinor: number;
  gstMinor: number;
  providerEarningMinor: number;
  platformRevenueMinor: number;
  adjustments: string[];
  planCode: string;
}

export interface Serviceman {
  id: string;
  active: boolean;
  created_at: ISODate;
  user_id: string;
  name: string | null;
  phone: string;
  active_jobs: number;
}

// ───────── Bookings ─────────
export type BookingStatus = 'pending' | 'accepted' | 'assigned' | 'en_route' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'refunded';

export interface Address {
  area: string;
  landmark: string;
  street?: string;
  lat?: number;
  lng?: number;
  contactPhone?: string;
}

export interface BookingListItem {
  id: string;
  code: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  scheduled_at: ISODate;
  total_minor: number;
  surcharge_minor: number;
  is_emergency: boolean;
  area: string | null;
  landmark: string | null;
  created_at: ISODate;
  service_name: string;
  zone_name: string;
  provider_name: string | null;
}

export interface BookingEvent {
  from_status: BookingStatus | null;
  to_status: BookingStatus;
  note: string | null;
  created_at: ISODate;
}

export interface Booking {
  id: string;
  code: string;
  customer_id: string;
  provider_id: string | null;
  serviceman_id: string | null;
  service_id: string;
  zone_id: string;
  quote_id: string;
  channel: 'app' | 'web' | 'ussd';
  status: BookingStatus;
  address: Address;
  notes: string | null;
  scheduled_at: ISODate;
  is_emergency: boolean;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal_minor: number;
  surcharge_minor: number;
  discount_minor?: number;
  total_minor: number;
  accepted_at: ISODate | null;
  started_at: ISODate | null;
  completed_at: ISODate | null;
  cancelled_at: ISODate | null;
  cancel_reason: string | null;
  disputed_at: ISODate | null;
  dispute_reason: string | null;
  created_at: ISODate;
  service_name: string;
  category_id: string;
  zone_name: string;
  provider_name: string | null;
  provider_rating: number | null;
  provider_phone: string | null;
  serviceman_name: string | null;
  serviceman_phone: string | null;
  customer_name: string | null;
  /** Null for open requests (hidden until a provider accepts). */
  customer_phone: string | null;
  price_breakdown: PriceBreakdown;
  review_rating: number | null;
  events: BookingEvent[];
  /** Customer only, until completed or cancelled. */
  start_code?: string;
  /** Customer only, once work is in progress. */
  completion_code?: string | null;
  /** Provider owner and admin only. */
  commission_minor?: number | null;
  commission_gst_minor?: number | null;
  provider_earning_minor?: number | null;
}

export interface CreateBookingBody {
  quoteId: string;
  address: Address;
  notes?: string;
  paymentMethod: PaymentMethod;
}

export type BookingScope = 'customer' | 'provider' | 'serviceman' | 'requests' | 'all';

export interface Review {
  id: string;
  booking_id: string;
  customer_id: string;
  provider_id: string;
  rating: number;
  comment: string | null;
  created_at: ISODate;
}

export interface PublicReview {
  rating: number;
  comment: string | null;
  created_at: ISODate;
  customer_first_name: string | null;
  service_name: string;
}

// ───────── Payments ─────────
export type PaymentPurpose = 'booking' | 'wallet_topup' | 'subscription' | 'cash_settlement';
export type PaymentState = 'initiated' | 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';

export interface CustomerAction {
  type: 'approve_on_phone' | 'dial_ussd' | 'redirect';
  message: string;
  ussdCode?: string;
  paymentCode?: string;
  redirectUrl?: string;
}

export interface Payment {
  id: string;
  user_id: string;
  purpose: PaymentPurpose;
  booking_id: string | null;
  subscription_id: string | null;
  provider_id: string | null;
  gateway: GatewayCode | 'wallet';
  msisdn: string | null;
  amount_minor: number;
  currency: string;
  idempotency_key: string;
  status: PaymentState;
  external_ref: string | null;
  customer_action: CustomerAction | null;
  failure_reason: string | null;
  expires_at: ISODate | null;
  completed_at: ISODate | null;
  created_at: ISODate;
  updated_at: ISODate;
  booking_code?: string | null;
}

export type CreatePaymentBody =
  | { purpose: 'booking'; bookingId: string; gateway: GatewayCode | 'wallet'; msisdn?: string }
  | { purpose: 'wallet_topup'; amountMinor: number; gateway: GatewayCode; msisdn: string }
  | { purpose: 'subscription'; planId: string; gateway: GatewayCode | 'wallet'; msisdn?: string }
  | { purpose: 'cash_settlement'; amountMinor?: number; gateway: GatewayCode; msisdn: string };

export interface PaymentMethodOption {
  code: PaymentMethod;
  name: string;
  type: 'mobile_money' | 'wallet' | 'cash';
  operator?: Exclude<Operator, 'unknown'> | null;
  sandbox?: boolean;
}

export interface PaymentMethods {
  operator: Operator | null;
  suggested: GatewayCode | null;
  methods: PaymentMethodOption[];
}

export interface SimulateResult {
  duplicate: boolean;
  result?: string;
  payment: Payment;
}

// ───────── Wallet ─────────
export type LedgerEntryType =
  | 'topup'
  | 'booking_payment'
  | 'refund'
  | 'job_earning'
  | 'commission'
  | 'commission_gst'
  | 'cash_commission_due'
  | 'cash_settlement'
  | 'payout'
  | 'payout_fee'
  | 'payout_reversal'
  | 'settlement_reversal'
  | (string & {});

export interface LedgerEntry {
  id: number | string;
  entry_type: LedgerEntryType;
  amount_minor: number;
  booking_id: string | null;
  payment_id: string | null;
  payout_id: string | null;
  memo: string | null;
  created_at: ISODate;
  running_balance_minor: number;
}

export interface Payout {
  id: string;
  provider_id: string;
  amount_minor: number;
  fee_minor: number;
  gateway: GatewayCode;
  msisdn: string;
  status: 'requested' | 'approved' | 'processing' | 'paid' | 'failed' | 'rejected';
  external_ref: string | null;
  failure_reason: string | null;
  created_at: ISODate;
  processed_at: ISODate | null;
  business_name?: string;
}

export interface CustomerWallet {
  account: 'customer';
  balance_minor: number;
  entries: LedgerEntry[];
}

export interface ProviderWallet {
  account: 'provider';
  balance_minor: number;
  available_minor: number;
  commission_owed_minor: number;
  cash_commission_limit_minor: number;
  payout_min_minor: number;
  payout_fee_minor: number;
  pending_payouts: Payout[];
  entries: LedgerEntry[];
}

export type Wallet = CustomerWallet | ProviderWallet;

// ───────── Badges ─────────
export interface BadgeDefinition {
  code: BadgeCode;
  name: string;
  description: string | null;
  kind: 'verification' | 'performance';
  required_documents: string[];
  validity_days: number | null;
  criteria: Record<string, number> | null;
  trust_weight: number;
  icon: string | null;
  sort_order: number;
  active: boolean;
}

export interface BadgeDocument {
  type: string;
  url: string;
  number?: string;
}

export interface BadgeVerifyResult {
  valid: boolean;
  reason: 'unknown_code' | 'expired' | 'provider_inactive' | BadgeStatus | null;
  badge?: string;
  badgeCode?: BadgeCode;
  provider?: string;
  ownerName?: string | null;
  rating?: number;
  completedJobs?: number;
  issuedAt?: ISODate | null;
  expiresAt?: ISODate | null;
}

export interface UploadResult {
  url: string;
  name: string;
  size: number;
}

export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
