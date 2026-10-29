import { ApiClient, type ApiClientOptions } from './client';
import type {
  BadgeDefinition, BadgeDocument, BadgeVerifyResult, Booking, BookingListItem, BookingScope, BookingStatus, Category,
  CommissionPlan, CommissionPreview, CreateBookingBody, CreatePaymentBody, CustomerWallet, DayCurve, Language, LoginResult,
  OtpRequestResult, Payment, PaymentMethods, Payout, ProviderBadge, ProviderMe, ProviderProfile, ProviderRegistration,
  ProviderSummary, ProviderWallet, PublicReview, Quote, QuoteRequest, Review, Service, Serviceman, SimulateResult,
  Subscription, Tokens, UploadContentType, UploadResult, User, Wallet, Zone, GatewayCode,
} from './types';

export type Paging = {
  limit?: number;
  offset?: number;
};

const enc = encodeURIComponent;

/** Typed endpoints over ApiClient. Every method maps 1:1 to a route in backend/src/modules. */
export function createFixamApi(client: ApiClient) {
  const c = client;
  return {
    client,

    auth: {
      requestOtp: (phone: string) => c.post<OtpRequestResult>('/auth/otp/request', { phone }, { auth: false }),
      /** Verifies the code and stores the tokens in the client's TokenStore. */
      verifyOtp: async (body: { phone: string; code: string; name?: string; language?: Language }) => {
        const res = await c.post<LoginResult>('/auth/otp/verify', body, { auth: false });
        await c.setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken, expiresIn: res.expiresIn });
        return res;
      },
      me: () => c.get<User>('/auth/me'),
      updateMe: (body: { name?: string; email?: string; language?: Language }) => c.patch<User>('/auth/me', body),
      refresh: () => c.refresh(),
      logout: async () => {
        const t = await c.getTokens();
        try {
          if (t?.refreshToken) await c.post('/auth/logout', { refreshToken: t.refreshToken }, { auth: false });
        } finally {
          await c.setTokens(null);
        }
      },
      setTokens: (t: Tokens | null) => c.setTokens(t),
    },

    zones: {
      list: () => c.get<Zone[]>('/zones', { auth: false }),
      /** 404 not_found when the point is outside every zone. */
      resolve: (lat: number, lng: number) => c.get<Zone>('/zones/resolve', { query: { lat, lng }, auth: false }),
    },

    catalog: {
      categories: () => c.get<Category[]>('/catalog/categories', { auth: false }),
      services: (q: { categoryId?: string; zoneId?: string; q?: string } = {}) => c.get<Service[]>('/catalog/services', { query: q, auth: false }),
      service: (id: string) => c.get<Service>(`/catalog/services/${enc(id)}`, { auth: false }),
    },

    pricing: {
      /** Locks the price for 15 minutes. Send it logged in so the quote is tied to the customer. */
      quote: (body: QuoteRequest) => c.post<Quote>('/pricing/quote', body),
      dayCurve: (q: { serviceId: string; zoneId: string; date: string; providerId?: string }) =>
        c.get<DayCurve>('/pricing/day-curve', { query: q, auth: false }),
    },

    providers: {
      search: (q: { zoneId?: string; serviceId?: string; badge?: string } & Paging = {}) =>
        c.get<ProviderSummary[]>('/providers', { query: q, auth: false }),
      get: (id: string) => c.get<ProviderProfile>(`/providers/${enc(id)}`, { auth: false }),
      reviews: (providerId: string, p: Paging = {}) => c.get<PublicReview[]>(`/reviews/provider/${enc(providerId)}`, { query: { ...p }, auth: false }),
      register: (body: ProviderRegistration) => c.post<ProviderMe>('/providers/register', body),
      me: () => c.get<ProviderMe>('/providers/me'),
      updateMe: (body: { businessName?: string; bio?: string; isAvailable?: boolean; payoutGateway?: GatewayCode; payoutMsisdn?: string }) =>
        c.patch<ProviderMe>('/providers/me', body),
      setZones: (zoneIds: string[]) => c.put<{ ok: true }>('/providers/me/zones', { zoneIds }),
      setServices: (services: { serviceId: string; priceOverrideMinor?: number | null }[]) => c.put<{ ok: true }>('/providers/me/services', { services }),
      commissionPreview: (q: { serviceId: string; subtotalMinor: number; surchargeMinor?: number }) =>
        c.get<CommissionPreview>('/providers/me/commission-preview', { query: q }),
      subscriptions: () => c.get<Subscription[]>('/providers/me/subscriptions'),
      servicemen: () => c.get<Serviceman[]>('/providers/me/servicemen'),
      addServiceman: (body: { name: string; phone: string }) => c.post<Serviceman>('/providers/me/servicemen', body),
      setServicemanActive: (id: string, active: boolean) => c.patch<Serviceman>(`/providers/me/servicemen/${enc(id)}`, { active }),
    },

    bookings: {
      create: (body: CreateBookingBody) => c.post<Booking>('/bookings', body),
      list: (q: { scope?: BookingScope; status?: BookingStatus } & Paging = {}) => c.get<BookingListItem[]>('/bookings', { query: q }),
      get: (id: string) => c.get<Booking>(`/bookings/${enc(id)}`),
      accept: (id: string) => c.post<Booking>(`/bookings/${enc(id)}/accept`),
      assign: (id: string, servicemanId: string) => c.post<Booking>(`/bookings/${enc(id)}/assign`, { servicemanId }),
      enRoute: (id: string) => c.post<Booking>(`/bookings/${enc(id)}/en-route`),
      start: (id: string, code: string) => c.post<Booking>(`/bookings/${enc(id)}/start`, { code }),
      complete: (id: string, code: string) => c.post<Booking>(`/bookings/${enc(id)}/complete`, { code }),
      cancel: (id: string, reason: string) => c.post<Booking>(`/bookings/${enc(id)}/cancel`, { reason }),
      dispute: (id: string, reason: string) => c.post<Booking>(`/bookings/${enc(id)}/dispute`, { reason }),
    },

    reviews: {
      create: (body: { bookingId: string; rating: number; comment?: string }) => c.post<Review>('/reviews', body),
    },

    payments: {
      methods: (msisdn?: string) => c.get<PaymentMethods>('/payments/methods', { query: { msisdn }, auth: false }),
      /**
       * Starts a collection. `idempotencyKey` must be reused for every retry of the same attempt.
       * Network errors are retried here with the same key; see PaymentSession for the full flow.
       */
      create: (body: CreatePaymentBody, idempotencyKey: string, opts: { retries?: number } = {}) =>
        c.post<Payment>('/payments', body, { headers: { 'Idempotency-Key': idempotencyKey }, retries: opts.retries ?? 2 }),
      list: (p: Paging = {}) => c.get<Payment[]>('/payments', { query: { ...p } }),
      /** Poll this while the payer approves on their phone; it also asks the gateway. */
      get: (id: string) => c.get<Payment>(`/payments/${enc(id)}`),
      /** Sandbox only. */
      simulate: (id: string, outcome?: 'succeeded' | 'failed') => c.post<SimulateResult>(`/payments/${enc(id)}/simulate`, outcome ? { outcome } : {}),
    },

    wallet: {
      get: (p: Paging = {}) => c.get<Wallet>('/wallet', { query: { ...p } }),
      customer: (p: Paging = {}) => c.get<CustomerWallet>('/wallet', { query: { ...p } }),
      provider: (p: Paging = {}) => c.get<ProviderWallet>('/wallet', { query: { ...p } }),
      requestPayout: (amountMinor: number) => c.post<Payout>('/wallet/payouts', { amountMinor }),
      payouts: (q: { status?: string } & Paging = {}) => c.get<Payout[]>('/wallet/payouts', { query: q }),
    },

    commission: {
      plans: () => c.get<CommissionPlan[]>('/commission/plans', { auth: false }),
    },

    badges: {
      definitions: () => c.get<BadgeDefinition[]>('/badges/definitions', { auth: false }),
      /** Public check of a code like FXB-XXXXXX. */
      verify: (code: string) => c.get<BadgeVerifyResult>(`/badges/verify/${enc(code.trim().toUpperCase())}`, { auth: false }),
      mine: () => c.get<ProviderBadge[]>('/badges/mine'),
      apply: (badgeCode: string, documents: BadgeDocument[]) => c.post<ProviderBadge>('/badges/apply', { badgeCode, documents }),
    },

    uploads: {
      /** Raw body upload. `data` is a Blob/ArrayBuffer/Uint8Array (RN: `await (await fetch(uri)).blob()`). */
      upload: (data: unknown, contentType: UploadContentType) =>
        c.post<UploadResult>('/uploads', undefined, { rawBody: data, contentType, timeoutMs: 120_000 }),
    },
  };
}

export type FixamApi = ReturnType<typeof createFixamApi>;

/** Convenience: client + endpoints in one call. */
export function createApi(opts: ApiClientOptions): FixamApi {
  return createFixamApi(new ApiClient(opts));
}
