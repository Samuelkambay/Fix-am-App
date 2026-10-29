import type pg from 'pg';
import { config } from '../../config.js';
import { one, query, tx, type Db, pool } from '../../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { formatLeone } from '../../lib/money.js';
import { detectOperator, normalizeSlPhone, OPERATOR_WALLET } from '../../lib/phone.js';
import { settleBooking } from '../commission/commission.service.js';
import { sendSms } from '../notifications/sms.js';
import { getSetting } from '../settings/settings.service.js';
import { balance, lockAccount, post } from '../wallet/ledger.js';
import { getGateway, GatewaySignatureError, isGatewayCode } from './gateways/index.js';
import { SANDBOX_WEBHOOK_SECRET, SandboxGateway } from './gateways/sandbox.js';
import { signPayload, SIGNATURE_HEADER } from './gateways/signing.js';

export type Purpose = 'booking' | 'wallet_topup' | 'subscription' | 'cash_settlement';
const FINAL = ['succeeded', 'failed', 'expired', 'refunded'];

export interface CreatePaymentInput {
  userId: string;
  purpose: Purpose;
  gateway: string; // a mobile money gateway code, or 'wallet'
  msisdn?: string;
  amountMinor: number;
  idempotencyKey: string;
  bookingId?: string;
  subscriptionId?: string;
  providerId?: string;
  description: string;
  reference: string;
}

/** Checks the wallet matches the SIM network: an Orange Money wallet cannot be charged on an Africell number. */
async function validateMsisdn(gatewayCode: string, msisdnRaw: string | undefined): Promise<string> {
  if (!msisdnRaw) throw badRequest('msisdn_required', 'Enter the mobile money number to charge');
  const msisdn = normalizeSlPhone(msisdnRaw);
  const gw = getGateway(gatewayCode);
  if (gw.operator && (await getSetting('payment.strict_operator_match'))) {
    const op = detectOperator(msisdn, await getSetting('phone_prefixes'));
    if (op !== 'unknown' && op !== gw.operator) {
      throw badRequest('wallet_network_mismatch', `${msisdn} is on ${op}. Choose ${OPERATOR_WALLET[op]} or use another number.`, {
        detectedOperator: op,
        suggestedGateway: OPERATOR_WALLET[op],
      });
    }
  }
  return msisdn;
}

export function publicPayment(p: any) {
  if (!p) return p;
  const { gateway_payload: _omit, ...rest } = p;
  return rest;
}

/**
 * Creates a payment and asks the gateway to collect it.
 * Idempotent per (user, Idempotency-Key): a retried request (flaky 2G/3G connections are common) returns the
 * original payment instead of charging twice.
 */
export async function createPayment(input: CreatePaymentInput) {
  const existing = await one('SELECT * FROM payments WHERE user_id = $1 AND idempotency_key = $2', [input.userId, input.idempotencyKey]);
  if (existing) {
    if (existing.amount_minor !== input.amountMinor || existing.purpose !== input.purpose || existing.gateway !== input.gateway) {
      throw conflict('idempotency_key_reused', 'This Idempotency-Key was already used for a different payment');
    }
    return existing;
  }

  if (input.gateway === 'wallet') return payFromWallet(input);

  const msisdn = await validateMsisdn(input.gateway, input.msisdn);
  const gw = getGateway(input.gateway);

  let payment: any;
  try {
    payment = await one(
      `INSERT INTO payments (user_id, purpose, booking_id, subscription_id, provider_id, gateway, msisdn, amount_minor, currency,
                             idempotency_key, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'initiated', now() + ($11 || ' seconds')::interval) RETURNING *`,
      [input.userId, input.purpose, input.bookingId ?? null, input.subscriptionId ?? null, input.providerId ?? null, input.gateway,
       msisdn, input.amountMinor, config.currency, input.idempotencyKey, String(config.paymentTtlSec)],
    );
  } catch (e: any) {
    if (e.code === '23505') return one('SELECT * FROM payments WHERE user_id = $1 AND idempotency_key = $2', [input.userId, input.idempotencyKey]);
    throw e;
  }

  // The gateway call happens outside any DB transaction so a slow operator API never holds locks.
  try {
    const result = await gw.initiateCollection({
      paymentId: payment.id,
      amountMinor: input.amountMinor,
      currency: config.currency,
      msisdn,
      reference: input.reference,
      description: input.description,
      callbackUrl: `${config.publicBaseUrl}/api/v1/webhooks/payments/${input.gateway}`,
    });
    payment = await one(
      `UPDATE payments SET external_ref = $2, status = 'pending', customer_action = $3, gateway_payload = $4, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [payment.id, result.externalRef, JSON.stringify(result.customerAction), JSON.stringify(result.raw ?? null)],
    );
    if (input.bookingId) await query(`UPDATE bookings SET payment_status = 'pending' WHERE id = $1 AND payment_status = 'unpaid'`, [input.bookingId]);
    if (result.status !== 'pending') await applyOutcome(payment.id, result.status, result.failureReason);
  } catch (e) {
    if (e instanceof AppError) throw e;
    await query(`UPDATE payments SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`, [payment.id, 'gateway_error']);
    throw new AppError(502, 'gateway_error', `${gw.displayName} is not responding. Try again or choose another method.`);
  }
  return one('SELECT * FROM payments WHERE id = $1', [payment.id]);
}

async function payFromWallet(input: CreatePaymentInput) {
  if (input.purpose === 'wallet_topup') throw badRequest('invalid_gateway', 'Top up the wallet with mobile money');
  if (input.purpose === 'cash_settlement') throw badRequest('invalid_gateway', 'Pay owed commission with mobile money');
  // Customers pay from their FixAm wallet; providers pay subscriptions from their earnings balance.
  const account = input.purpose === 'subscription' && input.providerId
    ? { type: 'provider' as const, id: input.providerId, entry: 'subscription_payment' }
    : { type: 'customer' as const, id: input.userId, entry: 'booking_payment' };
  return tx(async (c) => {
    await lockAccount(account.type, account.id, c);
    const bal = await balance(account.type, account.id, c);
    if (bal < input.amountMinor) {
      throw badRequest('insufficient_wallet_balance', `${account.type === 'provider' ? 'Earnings' : 'Wallet'} balance is ${formatLeone(bal)}. Pay with mobile money instead.`);
    }
    const payment = await one(
      `INSERT INTO payments (user_id, purpose, booking_id, subscription_id, provider_id, gateway, amount_minor, currency, idempotency_key, status, completed_at)
       VALUES ($1,$2,$3,$4,$5,'wallet',$6,$7,$8,'succeeded', now()) RETURNING *`,
      [input.userId, input.purpose, input.bookingId ?? null, input.subscriptionId ?? null, input.providerId ?? null, input.amountMinor, config.currency, input.idempotencyKey],
      c,
    );
    await post([{ accountType: account.type, accountId: account.id, entryType: account.entry, amountMinor: -input.amountMinor, paymentId: payment.id, bookingId: input.bookingId, memo: input.description }], c);
    await onSucceeded(payment, c);
    return payment;
  });
}

/** Moves a payment to a final state exactly once and runs the business side effects in the same transaction. */
export async function applyOutcome(paymentId: string, status: 'succeeded' | 'failed' | 'expired' | 'pending', failureReason?: string) {
  if (status === 'pending') return false;
  return tx(async (c) => {
    const p = await one('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId], c);
    if (!p || FINAL.includes(p.status)) return false; // late or duplicate notification: ignore
    const updated = await one(
      `UPDATE payments SET status = $2, failure_reason = $3, completed_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE completed_at END,
              updated_at = now() WHERE id = $1 RETURNING *`,
      [paymentId, status, failureReason ?? null],
      c,
    );
    if (status === 'succeeded') await onSucceeded(updated, c);
    else if (p.booking_id) {
      await c.query(`UPDATE bookings SET payment_status = 'unpaid' WHERE id = $1 AND payment_status = 'pending'`, [p.booking_id]);
      await sendSms(p.msisdn, `FixAm: your payment of ${formatLeone(p.amount_minor)} did not go through (${failureReason ?? status}). Open the app to try again.`, c);
    }
    return true;
  });
}

async function onSucceeded(p: any, c: pg.PoolClient) {
  switch (p.purpose as Purpose) {
    case 'booking': {
      // The method that actually paid becomes the booking's payment method (a failed attempt never relabels it).
      await c.query(`UPDATE bookings SET payment_status = 'paid', payment_method = $2 WHERE id = $1`, [p.booking_id, p.gateway]);
      await settleBooking(p.booking_id, c); // no-op until the job is completed
      break;
    }
    case 'wallet_topup':
      await post([{ accountType: 'customer', accountId: p.user_id, entryType: 'topup', amountMinor: p.amount_minor, paymentId: p.id, memo: `Top-up via ${p.gateway}` }], c);
      break;
    case 'cash_settlement':
      await post([{ accountType: 'provider', accountId: p.provider_id, entryType: 'cash_settlement', amountMinor: p.amount_minor, paymentId: p.id, memo: 'Commission paid by mobile money' }], c);
      break;
    case 'subscription': {
      const sub = await one('SELECT s.*, cp.subscription_period_days FROM provider_subscriptions s JOIN commission_plans cp ON cp.id = s.plan_id WHERE s.id = $1 FOR UPDATE', [p.subscription_id], c);
      // A renewal bought before expiry starts when the current period ends.
      const current = await one(
        `SELECT max(ends_at) AS ends_at FROM provider_subscriptions WHERE provider_id = $1 AND status = 'active' AND ends_at > now()`,
        [sub.provider_id],
        c,
      );
      const startsAt = current?.ends_at ? new Date(current.ends_at) : new Date();
      const endsAt = new Date(startsAt.getTime() + sub.subscription_period_days * 86400_000);
      await c.query(`UPDATE provider_subscriptions SET status = 'active', starts_at = $2, ends_at = $3, payment_id = $4 WHERE id = $1`, [sub.id, startsAt, endsAt, p.id]);
      await c.query(`UPDATE providers SET commission_plan_id = $2 WHERE id = $1`, [sub.provider_id, sub.plan_id]);
      const gstBps = await getSetting('commission.gst_rate_bps', c);
      const gst = Math.round((p.amount_minor * gstBps) / (10000 + gstBps)); // subscription price is GST-inclusive
      await post(
        [
          { accountType: 'platform_revenue', accountId: null, entryType: 'subscription_fee', amountMinor: p.amount_minor - gst, paymentId: p.id, memo: 'Provider subscription' },
          { accountType: 'platform_tax', accountId: null, entryType: 'subscription_gst', amountMinor: gst, paymentId: p.id, memo: 'GST on subscription' },
        ],
        c,
      );
      break;
    }
  }
}

/** Polls the gateway for a pending payment (the app calls this while the payer approves on their phone). */
export async function refreshPayment(paymentId: string) {
  const p = await one('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!p) throw notFound('Payment');
  if (p.status !== 'pending' || !p.external_ref || !isGatewayCode(p.gateway)) return p;
  const res = await getGateway(p.gateway).checkStatus(p.external_ref, p);
  if (res.status !== 'pending') await applyOutcome(p.id, res.status, res.failureReason);
  else if (p.expires_at && new Date(p.expires_at) < new Date()) await applyOutcome(p.id, 'expired', 'payer_did_not_approve');
  return one('SELECT * FROM payments WHERE id = $1', [paymentId]);
}

/** Entry point for operator callbacks. Verifies, de-duplicates and applies. Always cheap and idempotent. */
export async function handleWebhook(gatewayCode: string, headers: Record<string, any>, rawBody: string) {
  const gw = getGateway(gatewayCode);
  let event;
  try {
    event = gw.parseWebhook(headers, rawBody);
  } catch (e) {
    if (e instanceof GatewaySignatureError || e instanceof SyntaxError) {
      await query(
        `INSERT INTO payment_webhook_events (gateway, event_id, signature_ok, payload, result) VALUES ($1, $2, false, $3, $4)
         ON CONFLICT DO NOTHING`,
        [gatewayCode, `rejected:${Date.now()}:${Math.random()}`, JSON.stringify({ raw: rawBody.slice(0, 2000) }), (e as Error).message],
      );
      throw new AppError(401, 'invalid_signature', 'Webhook signature verification failed');
    }
    throw e;
  }

  const inserted = await one(
    `INSERT INTO payment_webhook_events (gateway, event_id, signature_ok, payload) VALUES ($1,$2,true,$3)
     ON CONFLICT (gateway, event_id) DO NOTHING RETURNING id`,
    [gatewayCode, event.eventId, JSON.stringify(event.raw)],
  );
  if (!inserted) return { duplicate: true };

  const payment = await one('SELECT id FROM payments WHERE gateway = $1 AND external_ref = $2', [gatewayCode, event.externalRef]);
  let result = 'unknown_reference';
  if (payment) result = (await applyOutcome(payment.id, event.status, event.failureReason)) ? `applied:${event.status}` : 'ignored_final';
  await query('UPDATE payment_webhook_events SET processed_at = now(), result = $2 WHERE id = $1', [inserted.id, result]);
  return { duplicate: false, result };
}

/** Sandbox only: plays the operator's part by sending a correctly signed webhook through the real handler. */
export async function simulateSandboxCallback(paymentId: string, outcome?: 'succeeded' | 'failed') {
  if (config.paymentMode !== 'sandbox') throw forbidden('Simulation is only available in sandbox mode');
  const p = await one('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!p) throw notFound('Payment');
  if (p.status !== 'pending') throw conflict('not_pending', `Payment is ${p.status}`);
  const gw = getGateway(p.gateway) as SandboxGateway;
  const natural = gw.outcomeFor(p.msisdn);
  const status = outcome ?? (natural.status === 'pending' ? 'succeeded' : natural.status);
  const body = JSON.stringify({
    event_id: `evt_${p.id}_${status}`,
    reference: p.external_ref,
    status,
    failure_reason: status === 'failed' ? natural.failureReason ?? 'declined_by_payer' : undefined,
  });
  return handleWebhook(p.gateway, { [SIGNATURE_HEADER]: signPayload(SANDBOX_WEBHOOK_SECRET, body) }, body);
}

/** Refunds a paid, not-yet-settled booking to the customer's FixAm wallet (instant, no operator fees). */
export async function refundBookingToWallet(bookingId: string, reason: string, c: Db) {
  const b = await one('SELECT * FROM bookings WHERE id = $1', [bookingId], c);
  if (!b || b.payment_status !== 'paid') return false;
  if (b.settled_at) throw conflict('already_settled', 'Completed jobs are refunded through a dispute');
  const p = await one(`SELECT id FROM payments WHERE booking_id = $1 AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`, [bookingId], c);
  await post([{ accountType: 'customer', accountId: b.customer_id, entryType: 'refund', amountMinor: b.total_minor, bookingId, paymentId: p?.id, memo: `Refund ${b.code}: ${reason}` }], c);
  await query(`UPDATE bookings SET payment_status = 'refunded' WHERE id = $1`, [bookingId], c);
  if (p) await query(`UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1`, [p.id], c);
  return true;
}

/** Background job: resolves payments that never received a callback. */
export async function reconcilePending(): Promise<number> {
  const rows = await query(`SELECT id FROM payments WHERE status = 'pending' AND created_at < now() - interval '30 seconds' ORDER BY created_at LIMIT 200`);
  for (const r of rows) {
    try {
      await refreshPayment(r.id);
    } catch (e) {
      console.error('reconcile failed', r.id, (e as Error).message);
    }
  }
  return rows.length;
}

export async function getPaymentFor(userId: string, paymentId: string, isAdmin: boolean, db: Db = pool) {
  const p = await one('SELECT * FROM payments WHERE id = $1', [paymentId], db);
  if (!p || (!isAdmin && p.user_id !== userId)) throw notFound('Payment');
  return p;
}
