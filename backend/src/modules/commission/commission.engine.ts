// Commission engine. Pure functions: the same code computes live settlements and the "what will I earn" preview.
import { applyBps } from '../../lib/money.js';

export interface CommissionPlan {
  id: string;
  code: string;
  name: string;
  model: 'commission' | 'subscription' | 'hybrid';
  default_rate_bps: number;
  subscription_rate_bps: number;
  surcharge_rate_bps: number | null;
  min_commission_minor: number;
  max_commission_minor: number | null;
  subscription_fee_minor: number;
  subscription_period_days: number;
  tiers: { min_gmv_minor: number; rate_bps: number }[];
}

export interface CommissionInput {
  subtotalMinor: number;
  surchargeMinor: number;
  discountMinor: number;
  plan: CommissionPlan;
  /** Rate for this job's category in the provider's plan, if the plan sets one. */
  categoryRateBps: number | null;
  /** Negotiated rate for this provider (admin set). Beats everything else. */
  providerOverrideBps: number | null;
  hasActiveSubscription: boolean;
  /** Provider's completed GMV over the last 30 days, for volume tiers. */
  trailingGmvMinor: number;
  gstRateBps: number;
  gstBorneBy: 'provider' | 'platform';
}

export type RateSource = 'provider_override' | 'subscription' | 'category' | 'volume_tier' | 'plan_default';

export interface CommissionResult {
  totalMinor: number;
  rateBps: number;
  rateSource: RateSource;
  surchargeRateBps: number;
  commissionMinor: number;
  gstMinor: number;
  /** What the provider keeps from the job. */
  providerEarningMinor: number;
  /** Platform income net of GST. */
  platformRevenueMinor: number;
  adjustments: string[];
}

export function resolveRate(input: CommissionInput): { rateBps: number; source: RateSource } {
  const { plan } = input;
  if (input.providerOverrideBps != null) return { rateBps: input.providerOverrideBps, source: 'provider_override' };
  // Subscription and hybrid plans only get their reduced rate while the subscription is paid up;
  // otherwise the provider falls back to pay-as-you-go commission.
  if (plan.model !== 'commission' && input.hasActiveSubscription) {
    return { rateBps: plan.subscription_rate_bps, source: 'subscription' };
  }
  if (input.categoryRateBps != null) return { rateBps: input.categoryRateBps, source: 'category' };
  const tier = [...(plan.tiers ?? [])]
    .sort((a, b) => b.min_gmv_minor - a.min_gmv_minor)
    .find((t) => input.trailingGmvMinor >= t.min_gmv_minor);
  if (tier) return { rateBps: tier.rate_bps, source: 'volume_tier' };
  return { rateBps: plan.default_rate_bps, source: 'plan_default' };
}

export function computeCommission(input: CommissionInput): CommissionResult {
  const totalMinor = input.subtotalMinor + input.surchargeMinor - input.discountMinor;
  const { rateBps, source } = resolveRate(input);
  // A plan may take a smaller cut of the peak surcharge so providers keep most of what they earn for working peak hours.
  const surchargeRateBps = source === 'provider_override' || source === 'subscription' ? rateBps : input.plan.surcharge_rate_bps ?? rateBps;
  const adjustments: string[] = [];

  let commission =
    applyBps(Math.max(input.subtotalMinor - input.discountMinor, 0), rateBps) + applyBps(input.surchargeMinor, surchargeRateBps);

  if (rateBps > 0 && commission < input.plan.min_commission_minor) {
    commission = input.plan.min_commission_minor;
    adjustments.push('minimum_commission');
  }
  if (input.plan.max_commission_minor != null && commission > input.plan.max_commission_minor) {
    commission = input.plan.max_commission_minor;
    adjustments.push('maximum_commission');
  }
  if (commission > totalMinor) {
    commission = totalMinor;
    adjustments.push('capped_at_job_total');
  }

  let gst: number;
  let providerEarning: number;
  let platformRevenue: number;
  if (input.gstBorneBy === 'provider') {
    // GST is added on top of the commission and deducted from the provider.
    gst = applyBps(commission, input.gstRateBps);
    if (commission + gst > totalMinor) gst = totalMinor - commission;
    providerEarning = totalMinor - commission - gst;
    platformRevenue = commission;
  } else {
    // GST is inside the commission: the platform remits part of what it keeps.
    gst = Math.round((commission * input.gstRateBps) / (10000 + input.gstRateBps));
    providerEarning = totalMinor - commission;
    platformRevenue = commission - gst;
  }

  return {
    totalMinor,
    rateBps,
    rateSource: source,
    surchargeRateBps,
    commissionMinor: commission,
    gstMinor: gst,
    providerEarningMinor: providerEarning,
    platformRevenueMinor: platformRevenue,
    adjustments,
  };
}
