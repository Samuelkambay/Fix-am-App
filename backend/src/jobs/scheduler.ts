import { one, query, tx } from '../db.js';
import { expireBadges } from '../modules/badges/badges.service.js';
import { reconcilePending, refundBookingToWallet } from '../modules/payments/payments.service.js';

/** Expires subscriptions whose period ended; providers fall back to pay-per-job commission automatically. */
export async function expireSubscriptions(): Promise<number> {
  const rows = await query(`UPDATE provider_subscriptions SET status = 'expired' WHERE status = 'active' AND ends_at <= now() RETURNING id`);
  return rows.length;
}

/** Cancels open requests nobody accepted well past their time, refunding any prepayment to the customer wallet. */
export async function expireStaleRequests(): Promise<number> {
  const stale = await query(`SELECT id FROM bookings WHERE status = 'pending' AND scheduled_at < now() - interval '2 hours'`);
  for (const { id } of stale) {
    await tx(async (c) => {
      const b = await one(`SELECT id FROM bookings WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id], c);
      if (!b) return;
      await c.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'No provider accepted in time' WHERE id = $1`, [id]);
      await c.query(`INSERT INTO booking_events (booking_id, from_status, to_status, note) VALUES ($1, 'pending', 'cancelled', 'Auto-cancelled: no provider accepted')`, [id]);
      await refundBookingToWallet(id, 'No provider accepted in time', c);
    });
  }
  return stale.length;
}

export async function runAllJobs() {
  return {
    paymentsReconciled: await reconcilePending(),
    badgesExpired: await expireBadges(),
    subscriptionsExpired: await expireSubscriptions(),
    requestsExpired: await expireStaleRequests(),
  };
}

export function startJobs() {
  const tick = () => runAllJobs().catch((e) => console.error('job error', e));
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 5_000).unref();
}
