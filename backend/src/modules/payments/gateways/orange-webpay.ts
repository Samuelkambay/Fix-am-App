import { GatewayNotConfiguredError, GatewaySignatureError } from './types.js';
import type {
  CollectionRequest, CollectionResult, GatewayEvent, MobileMoneyGateway, PaymentContext, PayoutRequest, PayoutResult, StatusResult,
} from './types.js';

/**
 * Orange Money Web Payment (OM WebPay) adapter, following the flow Orange documents on developer.orange.com:
 * OAuth2 client-credentials token -> POST /webpayment (returns payment_url, pay_token, notif_token)
 * -> customer approves with an OTP -> Orange POSTs {status, notif_token, txnid} to notif_url.
 *
 * Before go-live, confirm with Orange Sierra Leone that WebPay is enabled for SL merchants, and take the exact
 * base URL, currency code and field names from the spec Orange issues at merchant onboarding.
 * WebPay only collects money; payouts to providers need Orange's separate business API and are paid
 * manually from the merchant portal until that is set up.
 */
export class OrangeWebPayGateway implements MobileMoneyGateway {
  code = 'orange_money' as const;
  displayName = 'Orange Money';
  operator = 'orange' as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private cfg = {
      baseUrl: process.env.ORANGE_MONEY_BASE_URL ?? '',
      tokenUrl: process.env.ORANGE_MONEY_TOKEN_URL ?? 'https://api.orange.com/oauth/v3/token',
      clientId: process.env.ORANGE_MONEY_CLIENT_ID ?? '',
      clientSecret: process.env.ORANGE_MONEY_CLIENT_SECRET ?? '',
      merchantKey: process.env.ORANGE_MONEY_MERCHANT_KEY ?? '',
      currency: process.env.ORANGE_MONEY_CURRENCY ?? 'SLE',
      returnUrl: process.env.ORANGE_MONEY_RETURN_URL ?? 'https://fixam.sl/pay/return',
    },
  ) {}

  static isConfigured(): boolean {
    return !!(process.env.ORANGE_MONEY_BASE_URL && process.env.ORANGE_MONEY_CLIENT_ID && process.env.ORANGE_MONEY_MERCHANT_KEY);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Orange token request failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async call(path: string, body: unknown) {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(`Orange ${path} failed: ${res.status} ${json.message ?? ''}`);
    return json;
  }

  async initiateCollection(req: CollectionRequest): Promise<CollectionResult> {
    const json = await this.call('/webpayment', {
      merchant_key: this.cfg.merchantKey,
      currency: this.cfg.currency,
      order_id: req.paymentId,
      amount: Math.round(req.amountMinor / 100),
      return_url: this.cfg.returnUrl,
      cancel_url: this.cfg.returnUrl,
      notif_url: req.callbackUrl,
      lang: 'en',
      reference: req.reference,
    });
    // notif_token identifies the transaction in the callback, so it is our external reference.
    return {
      externalRef: json.notif_token,
      status: 'pending',
      customerAction: { type: 'redirect', redirectUrl: json.payment_url, message: 'Complete the payment on the Orange Money page with the OTP sent to your phone.' },
      raw: { pay_token: json.pay_token, notif_token: json.notif_token },
    };
  }

  async checkStatus(_externalRef: string, payment: PaymentContext): Promise<StatusResult> {
    const json = await this.call('/transactionstatus', {
      order_id: payment.id,
      amount: Math.round(payment.amount_minor / 100),
      pay_token: payment.gateway_payload?.pay_token,
    });
    return { status: mapOrangeStatus(json.status), raw: json };
  }

  parseWebhook(_headers: Record<string, string | string[] | undefined>, rawBody: string): GatewayEvent {
    // OM WebPay does not sign callbacks; authenticity comes from the unguessable notif_token, which must
    // match a payment we created. Unknown tokens are rejected by the payment service.
    const body = JSON.parse(rawBody);
    if (!body.notif_token || !body.status) throw new GatewaySignatureError('Missing notif_token/status');
    const status = mapOrangeStatus(body.status);
    if (status === 'pending') throw new GatewaySignatureError('Non-final status in callback');
    return { eventId: `${body.notif_token}:${body.txnid ?? body.status}`, externalRef: body.notif_token, status, raw: body };
  }

  async initiatePayout(_req: PayoutRequest): Promise<PayoutResult> {
    throw new GatewayNotConfiguredError('Orange Money payouts need the Orange Money business API. Pay manually and record the reference.');
  }
}

function mapOrangeStatus(s: string): 'pending' | 'succeeded' | 'failed' | 'expired' {
  switch (String(s).toUpperCase()) {
    case 'SUCCESS':
      return 'succeeded';
    case 'FAILED':
      return 'failed';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'pending';
  }
}
