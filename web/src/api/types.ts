// Types for the main API entities. Response rows use the database's snake_case columns;
// request bodies use camelCase (see docs/API.md). Money is integer minor units (100 = Le 1).

export type Role = 'customer' | 'provider' | 'serviceman' | 'admin';
export type Uuid = string;
export type Iso = string;

export interface AuthUser {
  id: Uuid;
  phone: string;
  name: string | null;
  email: string | null;
  role: Role;
  language: 'en' | 'kri';
  phone_verified_at: Iso | null;
  provider_id: Uuid | null;
  serviceman_id: Uuid | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse extends AuthTokens {
  user: AuthUser;
  isNewUser?: boolean;
}

export interface OtpRequestResponse {
  sent: boolean;
  phone: string;
  expiresIn: number;
  devCode?: string;
}

// ───────── Geography & catalog ─────────
export interface Zone {
  id: Uuid;
  name: string;
  district: string;
  city: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  active: boolean;
  created_at: Iso;
}

export interface Category {
  id: Uuid;
  parent_id: Uuid | null;
  slug: string;
  name: string;
  name_kri: string | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
  service_count: number;
  children: Category[];
}

export type PriceUnit = 'fixed' | 'hourly' | 'per_unit';

export interface Service {
  id: Uuid;
  category_id: Uuid;
  name: string;
  name_kri: string | null;
  description: string | null;
  base_price_minor: number;
  price_unit: PriceUnit;
  unit_label: string | null;
  duration_minutes: number;
  active: boolean;
  created_at: Iso;
  category_name: string;
  category_slug?: string;
}

// ───────── Pricing ─────────
export type RuleKind = 'time_window' | 'holiday' | 'seasonal' | 'demand' | 'emergency';

export interface PricingRule {
  id: Uuid;
  name: string;
  label: string;
  kind: RuleKind;
  zone_id: Uuid | null;
  category_id: Uuid | null;
  days_of_week: number[] | null;
  start_time: string | null; // "HH:MM:SS"
  end_time: string | null;
  date_from: string | null; // YYYY-MM-DD
  date_to: string | null;
  recurring_yearly: boolean;
  min_demand_ratio: number | null;
  multiplier: number;
  flat_fee_minor: number;
  stackable: boolean;
  priority: number;
  active: boolean;
}

export interface PricingRuleInput {
  name: string;
  label: string;
  kind: RuleKind;
  zoneId: Uuid | null;
  categoryId: Uuid | null;
  daysOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  recurringYearly: boolean;
  minDemandRatio: number | null;
  multiplier: number;
  flatFeeMinor: number;
  stackable: boolean;
  priority: number;
  active: boolean;
}

export interface AppliedRule {
  id: Uuid;
  label: string;
  kind: RuleKind;
  multiplier: number;
  flatFeeMinor: number;
  stacked: boolean;
}

export interface PriceLine {
  label: string;
  amountMinor: number;
}

export interface SimulateResult {
  subtotalMinor: number;
  multiplier: number;
  surchargeMinor: number;
  totalMinor: number;
  appliedRules: AppliedRule[];
  cappedBy: 'max_multiplier' | 'max_surcharge' | null;
  isPeak: boolean;
  lines: PriceLine[];
}

export interface SimulateInput {
  unitPriceMinor: number;
  quantity: number;
  zoneId: Uuid;
  categoryIds: Uuid[];
  scheduledAt: string;
  isEmergency: boolean;
  demandRatio: number;
}

export interface PriceBreakdown {
  unitPriceMinor: number;
  demandRatio: number;
  appliedRules: AppliedRule[];
  cappedBy: string | null;
  lines: PriceLine[];
}

// ───────── Bookings ─────────
export type BookingStatus = 'pending' | 'accepted' | 'assigned' | 'en_route' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';
export type PaymentMethod = 'cash' | 'wallet' | 'orange_money' | 'afrimoney' | 'qmoney' | 'monime';

export interface BookingListItem {
  id: Uuid;
  code: string;
  status: BookingStatus;
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded';
  payment_method: PaymentMethod;
  scheduled_at: Iso;
  total_minor: number;
  surcharge_minor: number;
  is_emergency: boolean;
  area: string | null;
  landmark: string | null;
  created_at: Iso;
  service_name: string;
  zone_name: string;
  provider_name: string | null;
}

export interface BookingAddress {
  area?: string;
  landmark?: string;
  street?: string;
  lat?: number;
  lng?: number;
  contactPhone?: string;
}

export interface BookingEvent {
  from_status: BookingStatus | null;
  to_status: BookingStatus;
  note: string | null;
  created_at: Iso;
}

export interface CommissionSnapshot {
  rateBps: number;
  rateSource: string;
  surchargeRateBps: number;
  commissionMinor: number;
  gstMinor: number;
  providerEarningMinor: number;
  platformRevenueMinor: number;
  adjustments: string[];
  planCode?: string;
}

export interface Booking extends Omit<BookingListItem, 'area' | 'landmark'> {
  customer_id: Uuid;
  provider_id: Uuid | null;
  serviceman_id: Uuid | null;
  service_id: Uuid;
  zone_id: Uuid;
  channel: 'app' | 'web' | 'ussd';
  address: BookingAddress;
  notes: string | null;
  subtotal_minor: number;
  discount_minor: number;
  commission_minor?: number | null;
  commission_gst_minor?: number | null;
  provider_earning_minor?: number | null;
  commission_snapshot?: CommissionSnapshot | null;
  dispute_reason: string | null;
  disputed_at: Iso | null;
  settled_at: Iso | null;
  accepted_at: Iso | null;
  started_at: Iso | null;
  completed_at: Iso | null;
  cancelled_at: Iso | null;
  cancel_reason: string | null;
  category_id: Uuid;
  provider_rating: number | null;
  provider_phone: string | null;
  serviceman_name: string | null;
  serviceman_phone: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  price_breakdown: PriceBreakdown | null;
  review_rating: number | null;
  events: BookingEvent[];
}

export type BookingScope = 'customer' | 'provider' | 'serviceman' | 'requests' | 'all';

// ───────── Providers ─────────
export type ProviderStatus = 'pending' | 'active' | 'suspended';
export type Gateway = 'orange_money' | 'afrimoney' | 'qmoney' | 'monime';

export interface ProviderRow {
  id: Uuid;
  owner_user_id: Uuid;
  business_name: string;
  kind: 'individual' | 'company';
  bio: string | null;
  status: ProviderStatus;
  commission_plan_id: Uuid | null;
  commission_override_bps: number | null;
  payout_msisdn: string | null;
  payout_gateway: Gateway | null;
  is_available: boolean;
  rating_avg: number;
  rating_count: number;
  completed_jobs: number;
  cancelled_jobs: number;
  trust_score: number;
  created_at: Iso;
}

export interface AdminProvider extends ProviderRow {
  owner_name: string | null;
  owner_phone: string;
  plan_name: string | null;
  balance_minor: number;
  pending_badges: number;
  zones: string[];
}

export interface ProviderBadge {
  id: Uuid;
  badge_code: string;
  status: BadgeStatus;
  verification_code: string;
  review_note: string | null;
  issued_at: Iso | null;
  expires_at: Iso | null;
  created_at: Iso;
  name: string;
  kind: 'verification' | 'performance';
  icon: string | null;
  description: string;
}

export interface ProviderService {
  id: Uuid;
  name: string;
  base_price_minor: number;
  price_override_minor: number | null;
  category_name: string;
}

export interface ProviderSubscription {
  id: Uuid;
  provider_id: Uuid;
  plan_id: Uuid;
  status: 'pending_payment' | 'active' | 'expired' | 'cancelled';
  starts_at: Iso | null;
  ends_at: Iso | null;
  payment_id: Uuid | null;
  created_at: Iso;
  plan_name?: string;
  subscription_fee_minor?: number;
}

export interface ProviderMe extends ProviderRow {
  zones: Zone[];
  services: ProviderService[];
  badges: ProviderBadge[];
  commission_plan: CommissionPlan;
  active_subscription: ProviderSubscription | null;
  balance_minor: number;
  commission_owed_minor: number;
  cash_commission_limit_minor: number;
  can_accept_jobs: boolean;
  accept_blockers: string[];
}

export interface Serviceman {
  id: Uuid;
  active: boolean;
  created_at: Iso;
  user_id: Uuid;
  name: string | null;
  phone: string;
  active_jobs: number;
}

// ───────── Commission ─────────
export type CommissionModel = 'commission' | 'subscription' | 'hybrid';

export interface Tier {
  min_gmv_minor: number;
  rate_bps: number;
}

export interface CategoryRate {
  plan_id: Uuid;
  category_id: Uuid;
  rate_bps: number;
  category_name: string;
}

export interface CommissionPlan {
  id: Uuid;
  code: string;
  name: string;
  model: CommissionModel;
  default_rate_bps: number;
  subscription_rate_bps: number;
  surcharge_rate_bps: number | null;
  min_commission_minor: number;
  max_commission_minor: number | null;
  subscription_fee_minor: number;
  subscription_period_days: number;
  tiers: Tier[];
  is_default: boolean;
  active: boolean;
  created_at: Iso;
  category_rates?: CategoryRate[];
}

export interface CommissionPlanInput {
  code: string;
  name: string;
  model: CommissionModel;
  defaultRateBps: number;
  subscriptionRateBps: number;
  surchargeRateBps: number | null;
  minCommissionMinor: number;
  maxCommissionMinor: number | null;
  subscriptionFeeMinor: number;
  subscriptionPeriodDays: number;
  tiers: Tier[];
  isDefault: boolean;
  active: boolean;
}

export type RateSource = 'provider_override' | 'subscription' | 'category' | 'volume_tier' | 'plan_default';

export interface CommissionResult {
  totalMinor: number;
  rateBps: number;
  rateSource: RateSource;
  surchargeRateBps: number;
  commissionMinor: number;
  gstMinor: number;
  providerEarningMinor: number;
  platformRevenueMinor: number;
  adjustments: string[];
  planCode?: string;
}

export interface CommissionSimulateInput {
  planId: Uuid;
  subtotalMinor: number;
  surchargeMinor: number;
  discountMinor: number;
  categoryId?: Uuid;
  providerOverrideBps: number | null;
  hasActiveSubscription: boolean;
  trailingGmvMinor: number;
}

// ───────── Badges ─────────
export type BadgeStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';

export interface BadgeDefinition {
  code: string;
  name: string;
  description: string;
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

export interface BadgeApplication {
  id: Uuid;
  provider_id: Uuid;
  badge_code: string;
  status: BadgeStatus;
  documents: BadgeDocument[];
  verification_code: string;
  reviewer_id: Uuid | null;
  review_note: string | null;
  issued_at: Iso | null;
  expires_at: Iso | null;
  created_at: Iso;
  updated_at: Iso;
  badge_name: string;
  kind: 'verification' | 'performance';
  business_name: string;
  owner_name: string | null;
  owner_phone: string;
}

export interface BadgeVerifyResult {
  valid: boolean;
  reason: string | null;
  badge?: string;
  badgeCode?: string;
  provider?: string;
  ownerName?: string | null;
  rating?: number;
  completedJobs?: number;
  issuedAt?: Iso | null;
  expiresAt?: Iso | null;
}

// ───────── Payments ─────────
export type PaymentStatus = 'initiated' | 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
export type PaymentPurpose = 'booking' | 'wallet_topup' | 'subscription' | 'cash_settlement';

export interface CustomerAction {
  type: 'approve_on_phone' | 'dial_ussd' | 'redirect';
  message: string;
  ussdCode?: string;
  paymentCode?: string;
  redirectUrl?: string;
}

export interface Payment {
  id: Uuid;
  user_id: Uuid;
  purpose: PaymentPurpose;
  booking_id: Uuid | null;
  subscription_id: Uuid | null;
  provider_id: Uuid | null;
  gateway: Gateway | 'wallet';
  msisdn: string | null;
  amount_minor: number;
  currency: string;
  status: PaymentStatus;
  idempotency_key: string;
  external_ref: string | null;
  customer_action: CustomerAction | null;
  failure_reason: string | null;
  expires_at: Iso | null;
  completed_at: Iso | null;
  created_at: Iso;
  updated_at: Iso;
  payer_name?: string | null;
  payer_phone?: string;
  booking_code?: string | null;
}

export type CreatePaymentBody =
  | { purpose: 'subscription'; planId: Uuid; gateway: Gateway; msisdn: string }
  | { purpose: 'cash_settlement'; amountMinor?: number; gateway: Gateway; msisdn: string };

export interface PaymentMethodInfo {
  code: string;
  name: string;
  type: 'mobile_money' | 'wallet' | 'cash';
  operator?: string | null;
  sandbox?: boolean;
}

export interface PaymentMethods {
  operator: 'orange' | 'africell' | 'qcell' | 'unknown' | null;
  suggested: string | null;
  methods: PaymentMethodInfo[];
}

export interface WebhookEvent {
  id: number;
  gateway: string;
  event_id: string;
  signature_ok: boolean;
  payload: unknown;
  processed_at: Iso | null;
  result: string | null;
  received_at: Iso;
}

// ───────── Wallet ─────────
export interface LedgerEntry {
  id: number;
  entry_type: string;
  amount_minor: number;
  booking_id: Uuid | null;
  payment_id: Uuid | null;
  payout_id: Uuid | null;
  memo: string | null;
  created_at: Iso;
  running_balance_minor: number;
}

export type PayoutStatus = 'requested' | 'approved' | 'processing' | 'paid' | 'failed' | 'rejected';

export interface Payout {
  id: Uuid;
  provider_id: Uuid;
  amount_minor: number;
  fee_minor: number;
  gateway: Gateway;
  msisdn: string;
  status: PayoutStatus;
  external_ref: string | null;
  failure_reason: string | null;
  reviewed_by: Uuid | null;
  created_at: Iso;
  processed_at: Iso | null;
  business_name?: string;
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

// ───────── Admin ─────────
export interface DashboardTotals {
  bookings: number;
  completed: number;
  cancelled: number;
  active: number;
  disputed: number;
  gmv_minor: number;
  peak_surcharge_minor: number;
  commission_minor: number;
  gst_minor: number;
  cash_bookings: number;
  ussd_bookings: number;
}

export interface Dashboard {
  period_days: number;
  totals: DashboardTotals;
  by_payment_method: { payment_method: PaymentMethod; n: number; amount_minor: number }[];
  by_zone: { name: string; n: number; gmv_minor: number }[];
  by_category: { name: string; n: number }[];
  providers: { status: ProviderStatus; n: number }[];
  pending_badge_reviews: number;
  pending_payouts: { n: number; amount_minor: number };
  cash_commission_outstanding: { owed_minor: number; providers: number };
  daily: { day: string; bookings: number; gmv_minor: number }[];
  platform_ledger: { account_type: string; entry_type: string; amount_minor: number }[];
}

export interface Settings {
  'pricing.max_multiplier': number;
  'pricing.max_surcharge_minor': number;
  'pricing.demand_window_hours': number;
  'commission.gst_rate_bps': number;
  'commission.gst_borne_by': 'provider' | 'platform';
  'cash.max_commission_due_minor': number;
  'payout.min_minor': number;
  'payout.fee_minor': number;
  'badges.required_to_accept_jobs': string[];
  'payment.strict_operator_match': boolean;
  phone_prefixes: Record<'orange' | 'africell' | 'qcell', string[]>;
}

export interface SmsMessage {
  id: number;
  phone: string;
  body: string;
  status: string;
  provider: string;
  created_at: Iso;
  sent_at: Iso | null;
}

export interface AuditLog {
  id: number;
  actor_id: Uuid | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  data: unknown;
  created_at: Iso;
}

export interface UploadResult {
  url: string;
  name: string;
  size: number;
}
