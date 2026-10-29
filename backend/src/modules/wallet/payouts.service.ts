import { config } from '../../config.js';
import { one, tx } from '../../db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatLeone } from '../../lib/money.js';
import { sendSms } from '../notifications/sms.js';
import { getGateway, GatewayNotConfiguredError } from '../payments/gateways/index.js';
import { getSetting } from '../settings/settings.service.js';
import { balance, lockAccount, post } from './ledger.js';

/**
 * Withdrawals from a provider's earnings to their mobile money wallet.
 * The amount (plus fee) is debited when requested, so the same money cannot be requested twice;
 * a rejected or failed payout posts a reversal.
 */
export async function requestPayout(providerId: string, amountMinor: number) {
  const [min, fee] = await Promise.all([getSetting('payout.min_minor'), getSetting('payout.fee_minor')]);
  if (amountMinor < min) throw badRequest('below_minimum', `Minimum withdrawal is ${formatLeone(min)}`);
  return tx(async (c) => {
    await lockAccount('provider', providerId, c);
    const p = await one('SELECT payout_msisdn, payout_gateway, status FROM providers WHERE id = $1', [providerId], c);
    if (!p.payout_msisdn || !p.payout_gateway) throw badRequest('payout_details_missing', 'Add your mobile money number for payouts first');
    if (p.status !== 'active') throw conflict('provider_inactive', 'Your account must be active to withdraw');
    const bal = await balance('provider', providerId, c);
    if (bal < amountMinor + fee) throw badRequest('insufficient_balance', `Available balance is ${formatLeone(Math.max(bal - fee, 0))}`);
    const payout = await one(
      `INSERT INTO payouts (provider_id, amount_minor, fee_minor, gateway, msisdn) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [providerId, amountMinor, fee, p.payout_gateway, p.payout_msisdn],
      c,
    );
    await post(
      [
        { accountType: 'provider', accountId: providerId, entryType: 'payout', amountMinor: -amountMinor, payoutId: payout.id, memo: `Withdrawal to ${p.payout_gateway}` },
        { accountType: 'provider', accountId: providerId, entryType: 'payout_fee', amountMinor: -fee, payoutId: payout.id, memo: 'Withdrawal fee' },
        { accountType: 'platform_revenue', accountId: null, entryType: 'payout_fee', amountMinor: fee, payoutId: payout.id, memo: 'Withdrawal fee' },
      ],
      c,
    );
    return payout;
  });
}

async function reverse(payoutId: string, reason: string, status: 'rejected' | 'failed', reviewerId: string | null) {
  return tx(async (c) => {
    const po = await one('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payoutId], c);
    if (!po) throw notFound('Payout');
    if (!['requested', 'approved', 'processing'].includes(po.status)) throw conflict('payout_final', `Payout is already ${po.status}`);
    await c.query('UPDATE payouts SET status = $2, failure_reason = $3, reviewed_by = COALESCE($4, reviewed_by), processed_at = now() WHERE id = $1', [
      po.id, status, reason, reviewerId,
    ]);
    await post(
      [
        { accountType: 'provider', accountId: po.provider_id, entryType: 'payout_reversal', amountMinor: po.amount_minor + po.fee_minor, payoutId: po.id, memo: `Withdrawal ${status}: ${reason}` },
        { accountType: 'platform_revenue', accountId: null, entryType: 'payout_fee_reversal', amountMinor: -po.fee_minor, payoutId: po.id, memo: 'Withdrawal fee returned' },
      ],
      c,
    );
    return one('SELECT * FROM payouts WHERE id = $1', [po.id], c);
  });
}

export const rejectPayout = (id: string, reviewerId: string, reason: string) => reverse(id, reason, 'rejected', reviewerId);

/** Admin approval sends the money through the operator. Without a payout API it stays approved for manual payment. */
export async function approvePayout(payoutId: string, reviewerId: string) {
  const po = await tx(async (c) => {
    const row = await one('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payoutId], c);
    if (!row) throw notFound('Payout');
    if (row.status !== 'requested') throw conflict('payout_not_requested', `Payout is already ${row.status}`);
    return one(`UPDATE payouts SET status = 'approved', reviewed_by = $2 WHERE id = $1 RETURNING *`, [payoutId, reviewerId], c);
  });
  try {
    const result = await getGateway(po.gateway).initiatePayout({
      payoutId: po.id, amountMinor: po.amount_minor, currency: config.currency, msisdn: po.msisdn, reference: `PAYOUT-${po.id.slice(0, 8)}`,
    });
    if (result.status === 'failed') return reverse(po.id, result.failureReason ?? 'operator_declined', 'failed', null);
    await one(`UPDATE payouts SET status = $2, external_ref = $3, processed_at = CASE WHEN $2 = 'paid' THEN now() END WHERE id = $1`, [
      po.id, result.status, result.externalRef,
    ]);
    if (result.status === 'paid') await notifyPaid(po.id);
  } catch (e) {
    if (!(e instanceof GatewayNotConfiguredError) && !(e as any)?.code?.startsWith?.('gateway')) throw e;
    // Stays 'approved': finance pays from the operator's merchant portal and records the reference with markPayoutPaid.
  }
  return one('SELECT * FROM payouts WHERE id = $1', [po.id]);
}

export async function markPayoutPaid(payoutId: string, reviewerId: string, externalRef: string) {
  const row = await one(
    `UPDATE payouts SET status = 'paid', external_ref = $3, reviewed_by = $2, processed_at = now()
      WHERE id = $1 AND status IN ('approved','processing') RETURNING *`,
    [payoutId, reviewerId, externalRef],
  );
  if (!row) throw conflict('payout_not_approved', 'Only approved payouts can be marked paid');
  await notifyPaid(row.id);
  return row;
}

async function notifyPaid(payoutId: string) {
  const r = await one(
    `SELECT po.amount_minor, po.msisdn, u.phone FROM payouts po JOIN providers p ON p.id = po.provider_id JOIN users u ON u.id = p.owner_user_id WHERE po.id = $1`,
    [payoutId],
  );
  await sendSms(r.phone, `FixAm: ${formatLeone(r.amount_minor)} has been sent to your mobile money ${r.msisdn}.`);
}
