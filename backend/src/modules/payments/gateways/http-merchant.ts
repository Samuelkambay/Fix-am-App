import { SIGNATURE_HEADER, verifySignature } from './signing.js';
import type {
  CollectionRequest, CollectionResult, GatewayCode, GatewayEvent, MobileMoneyGateway, PaymentContext, PayoutRequest, PayoutResult, StatusResult,
} from './types.js';

/**
 * Adapter template for merchant APIs whose specs are issued privately at onboarding
 * (Africell Afrimoney, QMoney, the Monime aggregator).
 *
 * It speaks a small JSON contract: POST /collections, GET /collections/:id, POST /payouts, and HMAC-signed
 * webhooks. Wiring a real operator means editing the request/response mapping in this file (or putting a thin
 * proxy in front that speaks this contract). Nothing here claims to be the operator's actual API.
 */
export class HttpMerchantGateway implements MobileMoneyGateway {
  private baseUrl: string;
  private apiKey: string;
  private merchantId: string;
  private webhookSecret: string;

  constructor(
    public code: GatewayCode,
    public displayName: string,
    public operator: MobileMoneyGateway['operator'],
    envPrefix: string,
  ) {
    this.baseUrl = process.env[`${envPrefix}_BASE_URL`] ?? '';
    this.apiKey = process.env[`${envPrefix}_API_KEY`] ?? '';
    this.merchantId = process.env[`${envPrefix}_MERCHANT_ID`] ?? process.env[`${envPrefix}_SPACE_ID`] ?? '';
    this.webhookSecret = process.env[`${envPrefix}_WEBHOOK_SECRET`] ?? '';
  }

  static isConfigured(envPrefix: string): boolean {
    return !!(process.env[`${envPrefix}_BASE_URL`] && process.env[`${envPrefix}_API_KEY`] && process.env[`${envPrefix}_WEBHOOK_SECRET`]);
  }

  private async request(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Merchant-Id': this.merchantId },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(`${this.displayName} ${method} ${path} failed: ${res.status} ${json.message ?? ''}`);
    return json;
  }

  async initiateCollection(req: CollectionRequest): Promise<CollectionResult> {
    const json = await this.request('POST', '/collections', {
      amount: (req.amountMinor / 100).toFixed(2),
      currency: req.currency,
      msisdn: req.msisdn,
      reference: req.reference,
      description: req.description,
      callback_url: req.callbackUrl,
      idempotency_key: req.paymentId,
    });
    return {
      externalRef: json.id,
      status: mapStatus(json.status) === 'succeeded' ? 'succeeded' : 'pending',
      customerAction: json.ussd_code
        ? { type: 'dial_ussd', ussdCode: json.ussd_code, paymentCode: json.payment_code, message: json.message ?? `Dial ${json.ussd_code} to approve` }
        : { type: 'approve_on_phone', message: json.message ?? 'Approve the payment prompt on your phone with your PIN.' },
      raw: json,
    };
  }

  async checkStatus(externalRef: string, _payment: PaymentContext): Promise<StatusResult> {
    const json = await this.request('GET', `/collections/${encodeURIComponent(externalRef)}`);
    return { status: mapStatus(json.status), failureReason: json.failure_reason, raw: json };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): GatewayEvent {
    verifySignature(this.webhookSecret, headers[SIGNATURE_HEADER], rawBody);
    const body = JSON.parse(rawBody);
    const status = mapStatus(body.status);
    return {
      eventId: body.event_id ?? `${body.id}:${body.status}`,
      externalRef: body.id ?? body.reference,
      status: status === 'pending' ? 'failed' : status,
      failureReason: body.failure_reason,
      raw: body,
    };
  }

  async initiatePayout(req: PayoutRequest): Promise<PayoutResult> {
    const json = await this.request('POST', '/payouts', {
      amount: (req.amountMinor / 100).toFixed(2),
      currency: req.currency,
      msisdn: req.msisdn,
      reference: req.reference,
      idempotency_key: req.payoutId,
    });
    const s = mapStatus(json.status);
    return { externalRef: json.id, status: s === 'succeeded' ? 'paid' : s === 'failed' ? 'failed' : 'processing', failureReason: json.failure_reason };
  }
}

function mapStatus(s: string): 'pending' | 'succeeded' | 'failed' | 'expired' {
  const v = String(s ?? '').toLowerCase();
  if (['success', 'successful', 'succeeded', 'completed', 'paid'].includes(v)) return 'succeeded';
  if (['failed', 'declined', 'rejected', 'cancelled', 'canceled'].includes(v)) return 'failed';
  if (['expired', 'timeout'].includes(v)) return 'expired';
  return 'pending';
}
