import { describe, expect, it } from 'vitest';
import { computeCommission, type CommissionInput, type CommissionPlan } from '../src/modules/commission/commission.engine.js';

const plan: CommissionPlan = {
  id: 'p', code: 'standard', name: 'Standard', model: 'commission', default_rate_bps: 1500, subscription_rate_bps: 0,
  surcharge_rate_bps: 1000, min_commission_minor: 1000, max_commission_minor: null, subscription_fee_minor: 0, subscription_period_days: 30,
  tiers: [{ min_gmv_minor: 0, rate_bps: 1500 }, { min_gmv_minor: 2_000_000, rate_bps: 1250 }, { min_gmv_minor: 5_000_000, rate_bps: 1000 }],
};

const base = (over: Partial<CommissionInput> = {}): CommissionInput => ({
  subtotalMinor: 100_000, surchargeMinor: 0, discountMinor: 0, plan, categoryRateBps: null, providerOverrideBps: null,
  hasActiveSubscription: false, trailingGmvMinor: 0, gstRateBps: 1500, gstBorneBy: 'provider', ...over,
});

describe('rate resolution', () => {
  it('uses volume tiers by trailing GMV', () => {
    expect(computeCommission(base()).rateBps).toBe(1500);
    expect(computeCommission(base({ trailingGmvMinor: 2_500_000 })).rateBps).toBe(1250);
    expect(computeCommission(base({ trailingGmvMinor: 9_000_000 })).rateSource).toBe('volume_tier');
    expect(computeCommission(base({ trailingGmvMinor: 9_000_000 })).rateBps).toBe(1000);
  });

  it('category rate beats tiers; provider override beats everything', () => {
    expect(computeCommission(base({ categoryRateBps: 1200, trailingGmvMinor: 9_000_000 }))).toMatchObject({ rateBps: 1200, rateSource: 'category' });
    expect(computeCommission(base({ categoryRateBps: 1200, providerOverrideBps: 700 }))).toMatchObject({ rateBps: 700, rateSource: 'provider_override' });
  });

  it('subscription rate only applies while the subscription is active', () => {
    const sub = { ...plan, model: 'subscription' as const, subscription_rate_bps: 0, tiers: [] };
    expect(computeCommission(base({ plan: sub, hasActiveSubscription: true }))).toMatchObject({ rateBps: 0, rateSource: 'subscription', commissionMinor: 0, gstMinor: 0, providerEarningMinor: 100_000 });
    expect(computeCommission(base({ plan: sub, hasActiveSubscription: false }))).toMatchObject({ rateBps: 1500, rateSource: 'plan_default' });
    // A plain commission plan ignores subscription status.
    expect(computeCommission(base({ hasActiveSubscription: true })).rateSource).toBe('volume_tier');
  });
});

describe('amounts', () => {
  it('takes a lower cut of the peak surcharge and adds GST for the provider to bear', () => {
    const r = computeCommission(base({ surchargeMinor: 25_000 }));
    // 15% of 100,000 + 10% of 25,000 = 15,000 + 2,500
    expect(r.commissionMinor).toBe(17_500);
    expect(r.gstMinor).toBe(2_625); // 15% of commission
    expect(r.providerEarningMinor).toBe(125_000 - 17_500 - 2_625);
    expect(r.platformRevenueMinor).toBe(17_500);
    expect(r.totalMinor).toBe(125_000);
  });

  it('treats GST as included when the platform bears it', () => {
    const r = computeCommission(base({ gstBorneBy: 'platform' }));
    expect(r.commissionMinor).toBe(15_000);
    expect(r.gstMinor).toBe(1_957); // 15000 * 15/115
    expect(r.providerEarningMinor).toBe(85_000);
    expect(r.platformRevenueMinor).toBe(15_000 - 1_957);
  });

  it('applies the minimum commission on small jobs, and never more than the job is worth', () => {
    expect(computeCommission(base({ subtotalMinor: 4_000 })).commissionMinor).toBe(1_000);
    expect(computeCommission(base({ subtotalMinor: 4_000 })).adjustments).toContain('minimum_commission');
    const tiny = computeCommission(base({ subtotalMinor: 500 }));
    expect(tiny.commissionMinor).toBe(500);
    expect(tiny.providerEarningMinor).toBe(0);
    expect(tiny.gstMinor).toBe(0);
  });

  it('applies the maximum commission', () => {
    const r = computeCommission(base({ subtotalMinor: 10_000_000, plan: { ...plan, max_commission_minor: 500_000 } }));
    expect(r.commissionMinor).toBe(500_000);
    expect(r.adjustments).toContain('maximum_commission');
  });

  it('commission base excludes discounts', () => {
    const r = computeCommission(base({ discountMinor: 20_000 }));
    expect(r.totalMinor).toBe(80_000);
    expect(r.commissionMinor).toBe(12_000);
  });

  it('always balances: earning + commission + GST = total (provider bears GST)', () => {
    for (const subtotal of [1_000, 33_333, 250_000, 1_234_567]) {
      for (const surcharge of [0, 7_777, 50_000]) {
        const r = computeCommission(base({ subtotalMinor: subtotal, surchargeMinor: surcharge }));
        expect(r.providerEarningMinor + r.commissionMinor + r.gstMinor).toBe(r.totalMinor);
        expect(r.providerEarningMinor).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
