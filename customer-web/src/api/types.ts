export type Role = 'customer' | 'provider' | 'serviceman' | 'admin';

export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  role: Role;
  language: 'en' | 'kri';
  provider_id: string | null;
  serviceman_id: string | null;
}

export interface Zone {
  id: string;
  name: string;
  district: string;
  city: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  name_kri: string | null;
  icon: string | null;
  service_count: number;
  children: Category[];
}

export interface Service {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  description: string | null;
  base_price_minor: number;
  price_unit: 'fixed' | 'hourly' | 'per_unit';
  unit_label: string | null;
  duration_minutes: number;
}

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
  badges: string[];
}

export interface ProviderProfile extends Omit<ProviderSummary, 'badges' | 'price_override_minor'> {
  badges: { code: string; name: string; kind: string; icon: string; verification_code: string; issued_at: string; expires_at: string | null }[];
  services: { id: string; name: string; price_minor: number; price_unit: string; unit_label: string | null }[];
  zones: { id: string; name: string }[];
}

export interface BadgeDefinition {
  code: string;
  name: string;
  description: string;
  kind: 'verification' | 'performance';
  icon: string;
  trust_weight: number;
}

export interface AppliedRule {
  id: string;
  label: string;
  kind: string;
  multiplier: number;
  flatFeeMinor: number;
  stacked: boolean;
}

export interface PriceBreakdown {
  unitPriceMinor: number;
  demandRatio: number;
  appliedRules: AppliedRule[];
  cappedBy: string | null;
  lines: { label: string; amountMinor: number }[];
}

export interface Quote {
  id: string;
  service_id: string;
  provider_id: string | null;
  zone_id: string;
  scheduled_at: string;
  is_emergency: boolean;
  quantity: number;
  subtotal_minor: number;
  surcharge_minor: number;
  total_minor: number;
  multiplier: number;
  breakdown: PriceBreakdown;
  expires_at: string;
}

export interface DayCurve {
  date: string;
  hours: { at: string; hour: number; totalMinor: number; surchargeMinor: number; multiplier: number; labels: string[]; isCheapest: boolean }[];
}

export type BookingStatus = 'pending' | 'accepted' | 'assigned' | 'en_route' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';
export type PaymentMethod = 'cash' | 'wallet' | 'orange_money' | 'afrimoney' | 'qmoney' | 'monime';

export interface BookingListItem {
  id: string;
  code: string;
  status: BookingStatus;
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded';
  payment_method: PaymentMethod;
  scheduled_at: string;
  total_minor: number;
  surcharge_minor: number;
  is_emergency: boolean;
  area: string;
  landmark: string;
  service_name: string;
  zone_name: string;
  provider_name: string | null;
}

export interface Booking extends Omit<BookingListItem, 'area' | 'landmark'> {
  address: { area: string; landmark: string; street?: string; contactPhone?: string };
  notes: string | null;
  subtotal_minor: number;
  discount_minor: number;
  provider_id: string | null;
  provider_rating: number | null;
  provider_phone: string | null;
  serviceman_name: string | null;
  serviceman_phone: string | null;
  price_breakdown: PriceBreakdown;
  review_rating: number | null;
  completed_at: string | null;
  cancel_reason: string | null;
  start_code?: string;
  completion_code?: string | null;
  events: { from_status: string | null; to_status: string; note: string | null; created_at: string }[];
}

export interface CustomerAction {
  type: 'approve_on_phone' | 'dial_ussd' | 'redirect';
  message: string;
  ussdCode?: string;
  paymentCode?: string;
  redirectUrl?: string;
}

export interface Payment {
  id: string;
  purpose: string;
  gateway: string;
  msisdn: string | null;
  amount_minor: number;
  status: 'initiated' | 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
  customer_action: CustomerAction | null;
  failure_reason: string | null;
  expires_at: string | null;
}

export interface PaymentMethodOption {
  code: string;
  name: string;
  type: 'mobile_money' | 'wallet' | 'cash';
  operator?: 'orange' | 'africell' | 'qcell' | null;
  sandbox?: boolean;
}

export interface PaymentMethods {
  operator: 'orange' | 'africell' | 'qcell' | 'unknown' | null;
  suggested: string | null;
  methods: PaymentMethodOption[];
}

export interface WalletEntry {
  id: number;
  entry_type: string;
  amount_minor: number;
  memo: string | null;
  created_at: string;
  running_balance_minor: number;
}

export interface BadgeCheck {
  valid: boolean;
  reason: string | null;
  badge?: string;
  badgeCode?: string;
  provider?: string;
  ownerName?: string;
  rating?: number;
  completedJobs?: number;
  issuedAt?: string;
  expiresAt?: string | null;
}

export interface Review {
  rating: number;
  comment: string | null;
  created_at: string;
  customer_first_name: string | null;
  service_name: string;
}
