import { one, query, type Db, pool } from '../../db.js';
import { conflict, notFound } from '../../lib/errors.js';
import { getSetting } from '../settings/settings.service.js';
import { post } from '../wallet/ledger.js';
import { computeCommission, type CommissionPlan, type CommissionResult } from './commission.engine.js';

export async function providerPlan(providerId: string, db: Db = pool): Promise<CommissionPlan> {
  const plan = await one<CommissionPlan>(
    `SELECT cp.* FROM providers p JOIN commission_plans cp ON cp.id = p.commission_plan_id WHERE p.id = $1`,
    [providerId],
    db,
  );
  if (plan) return plan;
  const fallback = await one<CommissionPlan>('SELECT * FROM commission_plans WHERE is_default', [], db);
  if (!fallback) throw notFound('Default commission plan');
  return fallback;
}

export async function hasActiveSubscription(providerId: string, at: Date, db: Db = pool): Promise<boolean> {
  const row = await one(
    `SELECT 1 FROM provider_subscriptions WHERE provider_id = $1 AND status = 'active' AND starts_at <= $2 AND ends_at > $2 LIMIT 1`,
    [providerId, at],
    db,
  );
  return !!row;
}

export async function trailingGmv(providerId: string, db: Db = pool): Promise<number> {
  const row = await one(
    `SELECT COALESCE(sum(total_minor), 0)::bigint AS gmv FROM bookings
      WHERE provider_id = $1 AND status = 'completed' AND completed_at > now() - interval '30 days'`,
    [providerId],
    db,
  );
  return Number(row?.gmv ?? 0);
}

export async function commissionFor(
  args: { providerId: string; categoryId: string; parentCategoryId?: string | null; subtotalMinor: number; surchargeMinor: number; discountMinor: number; at?: Date },
  db: Db = pool,
): Promise<CommissionResult & { planCode: string }> {
  const plan = await providerPlan(args.providerId, db);
  // Sequential on purpose: `db` may be a transaction client, which cannot run queries concurrently.
  const provider = await one('SELECT commission_override_bps FROM providers WHERE id = $1', [args.providerId], db);
  const categoryRate = await one(
    `SELECT rate_bps FROM commission_category_rates WHERE plan_id = $1 AND category_id = ANY($2::uuid[])
      ORDER BY (category_id = $3) DESC LIMIT 1`,
    [plan.id, [args.categoryId, args.parentCategoryId].filter(Boolean), args.categoryId],
    db,
  );
  const subscribed = await hasActiveSubscription(args.providerId, args.at ?? new Date(), db);
  const gmv = await trailingGmv(args.providerId, db);
  const gstRateBps = await getSetting('commission.gst_rate_bps', db);
  const gstBorneBy = await getSetting('commission.gst_borne_by', db);
  const result = computeCommission({
    subtotalMinor: args.subtotalMinor,
    surchargeMinor: args.surchargeMinor,
    discountMinor: args.discountMinor,
    plan,
    categoryRateBps: categoryRate?.rate_bps ?? null,
    providerOverrideBps: provider?.commission_override_bps ?? null,
    hasActiveSubscription: subscribed,
    trailingGmvMinor: gmv,
    gstRateBps,
    gstBorneBy,
  });
  return { ...result, planCode: plan.code };
}

/**
 * Splits a completed job's money between provider, platform and the tax authority.
 * Runs once per booking, when it is completed AND paid (digital) or completed with cash.
 *
 * Digital payment: the platform holds the customer's money, so the provider is credited their earning.
 * Cash: the provider already holds the full amount, so the provider is debited the platform's share
 *       (commission + GST). A negative provider balance is commission owed to the platform.
 */
export async function settleBooking(bookingId: string, db: Db): Promise<boolean> {
  const b = await one(
    `SELECT b.*, s.category_id, c.parent_id AS parent_category_id
       FROM bookings b JOIN services s ON s.id = b.service_id JOIN categories c ON c.id = s.category_id
      WHERE b.id = $1 FOR UPDATE OF b`,
    [bookingId],
    db,
  );
  if (!b) throw notFound('Booking');
  if (b.settled_at) return false;
  if (b.status !== 'completed') return false;
  const isCash = b.payment_method === 'cash';
  if (!isCash && b.payment_status !== 'paid') return false;
  if (!b.provider_id) throw conflict('no_provider', 'Booking has no provider');

  const c = await commissionFor(
    {
      providerId: b.provider_id,
      categoryId: b.category_id,
      parentCategoryId: b.parent_category_id,
      subtotalMinor: b.subtotal_minor,
      surchargeMinor: b.surcharge_minor,
      discountMinor: b.discount_minor,
      at: b.completed_at ? new Date(b.completed_at) : new Date(),
    },
    db,
  );

  const platformShare = c.totalMinor - c.providerEarningMinor;
  const memo = `Booking ${b.code}`;
  await post(
    [
      isCash
        ? { accountType: 'provider', accountId: b.provider_id, entryType: 'cash_commission_due', amountMinor: -platformShare, bookingId, memo: `${memo} (cash collected)` }
        : { accountType: 'provider', accountId: b.provider_id, entryType: 'job_earning', amountMinor: c.providerEarningMinor, bookingId, memo },
      { accountType: 'platform_revenue', accountId: null, entryType: 'commission', amountMinor: c.platformRevenueMinor, bookingId, memo },
      { accountType: 'platform_tax', accountId: null, entryType: 'commission_gst', amountMinor: c.gstMinor, bookingId, memo },
    ],
    db,
  );

  await query(
    `UPDATE bookings SET commission_minor = $2, commission_gst_minor = $3, provider_earning_minor = $4,
            commission_snapshot = $5, settled_at = now() WHERE id = $1`,
    [bookingId, c.commissionMinor, c.gstMinor, c.providerEarningMinor, JSON.stringify(c)],
    db,
  );
  return true;
}

export async function listPlans() {
  const plans = await query('SELECT * FROM commission_plans ORDER BY is_default DESC, name');
  const rates = await query(
    `SELECT r.plan_id, r.category_id, r.rate_bps, c.name AS category_name FROM commission_category_rates r JOIN categories c ON c.id = r.category_id`,
  );
  return plans.map((p) => ({ ...p, category_rates: rates.filter((r) => r.plan_id === p.id) }));
}
