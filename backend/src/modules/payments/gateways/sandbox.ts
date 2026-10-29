import { randomToken, readableCode } from '../../../lib/crypto.js';
import { formatLeone } from '../../../lib/money.js';
import { maskPhone } from '../../../lib/phone.js';
import { SIGNATURE_HEADER, verifySignature } from './signing.js';
import type {
  CollectionRequest, CollectionResult, GatewayCode, GatewayEvent, MobileMoneyGateway, PaymentContext, PayoutRequest, PayoutResult, StatusResult,
} from './types.js';

const NAMES: Record<GatewayCode, { name: string; operator: MobileMoneyGateway['operator'] }> = {
  orange_money: { name: 'Orange Money', operator: 'orange' },
  afrimoney: { name: 'Afrimoney', operator: 'africell' },
  qmoney: { name: 'QMoney', operator: 'qcell' },
  monime: { name: 'Monime (any network)', operator: null },
};

export const SANDBOX_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET_SANDBOX || 'sandbox-webhook-secret';

/**
 * Simulates an operator end to end so every app flow works before merchant accounts exist.
 * Test numbers (last three digits of the payer's number):
 *   ...000  -> payer declines / insufficient funds
 *   ...999  -> payer never approves (payment expires)
 *   others  -> approved after SANDBOX_AUTO_APPROVE_SEC seconds (default 8), or at once via the simulate endpoint
 */
export class SandboxGateway implements MobileMoneyGateway {
  displayName: string;
  operator: MobileMoneyGateway['operator'];
  private autoApproveSec = Number(process.env.SANDBOX_AUTO_APPROVE_SEC ?? 8);

  constructor(public code: GatewayCode) {
    this.displayName = `${NAMES[code].name} (sandbox)`;
    this.operator = NAMES[code].operator;
  }

  async initiateCollection(req: CollectionRequest): Promise<CollectionResult> {
    const externalRef = `sbx_${this.code}_${randomToken(9)}`;
    if (this.code === 'monime') {
      const paymentCode = readableCode(6);
      return {
        externalRef,
        status: 'pending',
        customerAction: {
          type: 'dial_ussd',
          paymentCode,
          message: `Pay ${formatLeone(req.amountMinor)} with any mobile money wallet using payment code ${paymentCode}.`,
        },
      };
    }
    return {
      externalRef,
      status: 'pending',
      customerAction: {
        type: 'approve_on_phone',
        message: `Check your phone ${maskPhone(req.msisdn)}: enter your ${NAMES[this.code].name} PIN to pay ${formatLeone(req.amountMinor)} to FixAm.`,
      },
    };
  }

  async checkStatus(_externalRef: string, payment: PaymentContext): Promise<StatusResult> {
    const ageSec = (Date.now() - new Date(payment.created_at).getTime()) / 1000;
    if (ageSec < this.autoApproveSec) return { status: 'pending' };
    return this.outcomeFor(payment.msisdn);
  }

  outcomeFor(msisdn: string): StatusResult {
    if (msisdn.endsWith('000')) return { status: 'failed', failureReason: 'insufficient_funds' };
    if (msisdn.endsWith('999')) return { status: 'pending' };
    return { status: 'succeeded' };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): GatewayEvent {
    verifySignature(SANDBOX_WEBHOOK_SECRET, headers[SIGNATURE_HEADER], rawBody);
    const body = JSON.parse(rawBody);
    return { eventId: body.event_id, externalRef: body.reference, status: body.status, failureReason: body.failure_reason, raw: body };
  }

  async initiatePayout(req: PayoutRequest): Promise<PayoutResult> {
    if (req.msisdn.endsWith('000')) return { externalRef: `sbx_po_${randomToken(9)}`, status: 'failed', failureReason: 'wallet_not_found' };
    return { externalRef: `sbx_po_${randomToken(9)}`, status: 'paid' };
  }
}
