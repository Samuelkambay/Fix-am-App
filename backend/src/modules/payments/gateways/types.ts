export type GatewayCode = 'orange_money' | 'afrimoney' | 'qmoney' | 'monime';
export const GATEWAY_CODES: GatewayCode[] = ['orange_money', 'afrimoney', 'qmoney', 'monime'];

export interface CustomerAction {
  /**
   * approve_on_phone: the operator pushes a PIN prompt to the payer's handset
   * dial_ussd:        the payer dials a USSD string to approve (optionally with a payment code)
   * redirect:         open a hosted payment page (web checkout)
   */
  type: 'approve_on_phone' | 'dial_ussd' | 'redirect';
  message: string;
  ussdCode?: string;
  paymentCode?: string;
  redirectUrl?: string;
}

export interface CollectionRequest {
  paymentId: string;
  amountMinor: number;
  currency: string;
  msisdn: string;
  reference: string;
  description: string;
  callbackUrl: string;
}

export interface CollectionResult {
  externalRef: string;
  status: 'pending' | 'succeeded' | 'failed';
  customerAction: CustomerAction;
  failureReason?: string;
  raw?: unknown;
}

export interface StatusResult {
  status: 'pending' | 'succeeded' | 'failed' | 'expired';
  failureReason?: string;
  raw?: unknown;
}

export interface GatewayEvent {
  eventId: string;
  externalRef: string;
  status: 'succeeded' | 'failed' | 'expired';
  failureReason?: string;
  raw: unknown;
}

export interface PayoutRequest {
  payoutId: string;
  amountMinor: number;
  currency: string;
  msisdn: string;
  reference: string;
}

export interface PayoutResult {
  externalRef: string;
  status: 'processing' | 'paid' | 'failed';
  failureReason?: string;
}

export interface PaymentContext {
  id: string;
  created_at: Date;
  msisdn: string;
  amount_minor: number;
  gateway_payload: any;
}

export interface MobileMoneyGateway {
  code: GatewayCode;
  displayName: string;
  /** SIM network the wallet lives on; null for aggregators that accept any network. */
  operator: 'orange' | 'africell' | 'qcell' | null;
  initiateCollection(req: CollectionRequest): Promise<CollectionResult>;
  checkStatus(externalRef: string, payment: PaymentContext): Promise<StatusResult>;
  /** Verifies authenticity and parses an incoming webhook. Throws on a bad signature. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): GatewayEvent;
  initiatePayout(req: PayoutRequest): Promise<PayoutResult>;
}

export class GatewaySignatureError extends Error {}
export class GatewayNotConfiguredError extends Error {}
