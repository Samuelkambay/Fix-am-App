// Typed endpoint functions, grouped by API module. Paths are relative to API_BASE (/api/v1).
import { http, idempotencyKey } from './client';
import type {
  AdminProvider, AuditLog, AuthUser, BadgeApplication, BadgeDefinition, BadgeDocument, BadgeStatus, BadgeVerifyResult, Booking,
  BookingListItem, BookingScope, Category, CommissionPlan, CommissionPlanInput, CommissionResult, CommissionSimulateInput,
  CreatePaymentBody, Dashboard, Gateway, LoginResponse, OtpRequestResponse, Payment, PaymentMethods, Payout, PricingRule,
  PricingRuleInput, ProviderBadge, ProviderMe, ProviderRow, ProviderStatus, ProviderSubscription, ProviderWallet, Service,
  Serviceman, Settings, SimulateInput, SimulateResult, SmsMessage, UploadResult, Uuid, WebhookEvent, Zone,
} from './types';

export * from './client';
export * from './types';

const noAuth = { auth: false } as const;

export const authApi = {
  login: (phone: string, password: string) => http.post<LoginResponse>('/auth/login', { phone, password }, noAuth),
  requestOtp: (phone: string) => http.post<OtpRequestResponse>('/auth/otp/request', { phone }, noAuth),
  verifyOtp: (phone: string, code: string) => http.post<LoginResponse>('/auth/otp/verify', { phone, code }, noAuth),
  logout: (refreshToken: string) => http.post<{ ok: true }>('/auth/logout', { refreshToken }, noAuth),
  me: () => http.get<AuthUser>('/auth/me'),
};

export const adminApi = {
  dashboard: (days = 30) => http.get<Dashboard>('/admin/dashboard', { days }),
  providers: (q: { status?: string; q?: string; limit?: number; offset?: number } = {}) => http.get<AdminProvider[]>('/admin/providers', q),
  settings: () => http.get<Settings>('/admin/settings'),
  saveSettings: (patch: Partial<Settings>) => http.put<Settings>('/admin/settings', patch),
  smsOutbox: (limit = 100, offset = 0) => http.get<SmsMessage[]>('/admin/sms-outbox', { limit, offset }),
  auditLogs: (limit = 100, offset = 0) => http.get<AuditLog[]>('/admin/audit-logs', { limit, offset }),
};

export const catalogApi = {
  categories: () => http.get<Category[]>('/catalog/categories'),
  services: (q: { categoryId?: string; zoneId?: string; q?: string } = {}) => http.get<Service[]>('/catalog/services', q),
  createCategory: (b: { slug: string; name: string; nameKri?: string; icon?: string; parentId?: string | null; sortOrder?: number; active?: boolean }) =>
    http.post<Category>('/catalog/categories', b),
  updateCategory: (id: Uuid, b: Partial<{ slug: string; name: string; nameKri: string; icon: string; sortOrder: number; active: boolean }>) =>
    http.patch<Category>(`/catalog/categories/${id}`, b),
  createService: (b: ServiceInput) => http.post<Service>('/catalog/services', b),
  updateService: (id: Uuid, b: Partial<ServiceInput>) => http.patch<Service>(`/catalog/services/${id}`, b),
};

export interface ServiceInput {
  categoryId: Uuid;
  name: string;
  nameKri?: string;
  description?: string;
  basePriceMinor: number;
  priceUnit: 'fixed' | 'hourly' | 'per_unit';
  unitLabel?: string;
  durationMinutes: number;
  active?: boolean;
}

export interface ZoneInput {
  name: string;
  district: string;
  city: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  active?: boolean;
}

export const zonesApi = {
  list: () => http.get<Zone[]>('/zones'),
  create: (b: ZoneInput) => http.post<Zone>('/zones', b),
  update: (id: Uuid, b: Partial<ZoneInput>) => http.patch<Zone>(`/zones/${id}`, b),
};

export const bookingsApi = {
  list: (scope: BookingScope, q: { status?: string; limit?: number; offset?: number } = {}) =>
    http.get<BookingListItem[]>('/bookings', { scope, ...q }),
  get: (id: Uuid) => http.get<Booking>(`/bookings/${id}`),
  accept: (id: Uuid) => http.post<Booking>(`/bookings/${id}/accept`),
  assign: (id: Uuid, servicemanId: Uuid) => http.post<Booking>(`/bookings/${id}/assign`, { servicemanId }),
  enRoute: (id: Uuid) => http.post<Booking>(`/bookings/${id}/en-route`),
  start: (id: Uuid, code: string) => http.post<Booking>(`/bookings/${id}/start`, { code }),
  complete: (id: Uuid, code: string) => http.post<Booking>(`/bookings/${id}/complete`, { code }),
  cancel: (id: Uuid, reason: string) => http.post<Booking>(`/bookings/${id}/cancel`, { reason }),
  resolve: (id: Uuid, resolution: 'release' | 'refund', note: string) => http.post<Booking>(`/bookings/${id}/resolve`, { resolution, note }),
};

export const providersApi = {
  me: () => http.get<ProviderMe>('/providers/me'),
  updateMe: (b: { businessName?: string; bio?: string; isAvailable?: boolean; payoutGateway?: Gateway; payoutMsisdn?: string }) =>
    http.patch<ProviderRow>('/providers/me', b),
  setZones: (zoneIds: Uuid[]) => http.put<{ ok: true }>('/providers/me/zones', { zoneIds }),
  setServices: (services: { serviceId: Uuid; priceOverrideMinor?: number | null }[]) => http.put<{ ok: true }>('/providers/me/services', { services }),
  commissionPreview: (serviceId: Uuid, subtotalMinor: number, surchargeMinor = 0) =>
    http.get<CommissionResult>('/providers/me/commission-preview', { serviceId, subtotalMinor, surchargeMinor }),
  subscriptions: () => http.get<ProviderSubscription[]>('/providers/me/subscriptions'),
  servicemen: () => http.get<Serviceman[]>('/providers/me/servicemen'),
  addServiceman: (name: string, phone: string) => http.post<Serviceman>('/providers/me/servicemen', { name, phone }),
  setServicemanActive: (id: Uuid, active: boolean) => http.patch<Serviceman>(`/providers/me/servicemen/${id}`, { active }),
  register: (b: { businessName: string; kind: 'individual' | 'company'; bio?: string; zoneIds: Uuid[]; services: { serviceId: Uuid }[]; payoutGateway?: Gateway; payoutMsisdn?: string }) =>
    http.post<ProviderRow>('/providers/register', b),
  // Admin
  setStatus: (id: Uuid, status: ProviderStatus, note?: string) => http.post<ProviderRow>(`/providers/${id}/status`, { status, note }),
};

export const pricingApi = {
  rules: () => http.get<PricingRule[]>('/pricing/rules'),
  createRule: (b: PricingRuleInput) => http.post<PricingRule>('/pricing/rules', b),
  updateRule: (id: Uuid, b: Partial<PricingRuleInput>) => http.patch<PricingRule>(`/pricing/rules/${id}`, b),
  deleteRule: (id: Uuid) => http.del<void>(`/pricing/rules/${id}`),
  simulate: (b: SimulateInput) => http.post<SimulateResult>('/pricing/simulate', b),
};

export const commissionApi = {
  plans: () => http.get<CommissionPlan[]>('/commission/plans'),
  allPlans: () => http.get<CommissionPlan[]>('/commission/plans/all'),
  createPlan: (b: CommissionPlanInput) => http.post<CommissionPlan>('/commission/plans', b),
  updatePlan: (id: Uuid, b: Partial<CommissionPlanInput>) => http.patch<CommissionPlan>(`/commission/plans/${id}`, b),
  setCategoryRates: (id: Uuid, rates: { categoryId: Uuid; rateBps: number }[]) => http.put<CommissionPlan>(`/commission/plans/${id}/category-rates`, { rates }),
  setProvider: (providerId: Uuid, b: { planId?: Uuid; overrideBps?: number | null }) =>
    http.patch<{ id: Uuid; business_name: string; commission_plan_id: Uuid; commission_override_bps: number | null }>(`/commission/providers/${providerId}`, b),
  simulate: (b: CommissionSimulateInput) => http.post<CommissionResult>('/commission/simulate', b),
};

export const badgesApi = {
  definitions: () => http.get<BadgeDefinition[]>('/badges/definitions'),
  verify: (code: string) => http.get<BadgeVerifyResult>(`/badges/verify/${encodeURIComponent(code.trim())}`, undefined, noAuth),
  mine: () => http.get<ProviderBadge[]>('/badges/mine'),
  apply: (badgeCode: string, documents: BadgeDocument[]) => http.post<BadgeApplication>('/badges/apply', { badgeCode, documents }),
  applications: (status: BadgeStatus = 'pending', limit = 200) => http.get<BadgeApplication[]>('/badges/applications', { status, limit }),
  review: (id: Uuid, decision: 'approve' | 'reject', note?: string) => http.post<BadgeApplication>(`/badges/applications/${id}/review`, { decision, note }),
  revoke: (id: Uuid, note: string) => http.post<BadgeApplication>(`/badges/${id}/revoke`, { note }),
};

export const uploadsApi = {
  upload: (file: Blob) => http.post<UploadResult>('/uploads', file, { rawContentType: file.type }),
  /** Uploaded files need the auth header, so they are fetched as blobs rather than linked. */
  fetchBlob: (url: string) => http.get<Blob>(url, undefined, { responseType: 'blob' }),
};

export const paymentsApi = {
  methods: (msisdn?: string) => http.get<PaymentMethods>('/payments/methods', { msisdn }, noAuth),
  create: (body: CreatePaymentBody, key = idempotencyKey()) => http.post<Payment>('/payments', body, { headers: { 'Idempotency-Key': key } }),
  get: (id: Uuid) => http.get<Payment>(`/payments/${id}`),
  list: (q: { status?: string; limit?: number; offset?: number } = {}) => http.get<Payment[]>('/payments', q),
  simulate: (id: Uuid, outcome?: 'succeeded' | 'failed') =>
    http.post<{ duplicate: boolean; result?: string; payment: Payment }>(`/payments/${id}/simulate`, outcome ? { outcome } : {}),
  webhookEvents: (limit = 100, offset = 0) => http.get<WebhookEvent[]>('/payments/admin/webhook-events', { limit, offset }),
};

export const walletApi = {
  get: (limit = 100, offset = 0) => http.get<ProviderWallet>('/wallet', { limit, offset }),
  requestPayout: (amountMinor: number) => http.post<Payout>('/wallet/payouts', { amountMinor }),
  payouts: (status?: string, limit = 100) => http.get<Payout[]>('/wallet/payouts', { status, limit }),
  approvePayout: (id: Uuid) => http.post<Payout>(`/wallet/payouts/${id}/approve`),
  rejectPayout: (id: Uuid, reason: string) => http.post<Payout>(`/wallet/payouts/${id}/reject`, { reason }),
  markPaid: (id: Uuid, externalRef: string) => http.post<Payout>(`/wallet/payouts/${id}/mark-paid`, { externalRef }),
};
