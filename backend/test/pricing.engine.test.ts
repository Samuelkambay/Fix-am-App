import { describe, expect, it } from 'vitest';
import { computePrice, ruleMatches, type PricingRule } from '../src/modules/pricing/pricing.engine.js';

const ZONE = 'zone-1';
const CAT = 'cat-electrical';

function rule(p: Partial<PricingRule>): PricingRule {
  return {
    id: p.name ?? 'r', name: 'r', label: 'Rule', kind: 'time_window', zone_id: null, category_id: null, days_of_week: null,
    start_time: null, end_time: null, date_from: null, date_to: null, recurring_yearly: false, min_demand_ratio: null,
    multiplier: 1, flat_fee_minor: 0, stackable: false, priority: 0, active: true, ...p,
  };
}

const input = (at: string, extra: Partial<Parameters<typeof computePrice>[0]> = {}) => ({
  unitPriceMinor: 25000, quantity: 1, zoneId: ZONE, categoryIds: [CAT], scheduledAt: new Date(at), isEmergency: false, demandRatio: 0, ...extra,
});
const guard = { maxMultiplier: 1.75, maxSurchargeMinor: null };

const evening = rule({ name: 'evening', label: 'Evening peak', days_of_week: [1, 2, 3, 4, 5], start_time: '17:00:00', end_time: '21:00:00', multiplier: 1.25, priority: 10 });
const night = rule({ name: 'night', label: 'Night call-out', start_time: '21:00', end_time: '06:00', multiplier: 1.5, flat_fee_minor: 5000, priority: 20 });
const fridayNight = rule({ name: 'friday-night', days_of_week: [5], start_time: '22:00', end_time: '04:00', multiplier: 1.3 });
const urgent = rule({ name: 'urgent', label: 'Urgent job', kind: 'emergency', multiplier: 1.2, flat_fee_minor: 10000, stackable: true, priority: 30 });
const demand = rule({ name: 'demand', label: 'High demand', kind: 'demand', min_demand_ratio: 2, multiplier: 1.2, stackable: true, priority: 25 });
const xmas = rule({ name: 'xmas', label: 'Holiday rate', kind: 'holiday', date_from: '2026-12-24', date_to: '2026-01-01', recurring_yearly: true, multiplier: 1.3, priority: 15 });
const rainyRoofing = rule({ name: 'rainy', kind: 'seasonal', category_id: 'cat-roofing', date_from: '2026-06-01', date_to: '2026-09-30', recurring_yearly: true, multiplier: 1.2 });

describe('time windows (Africa/Freetown, UTC+0)', () => {
  it('applies weekday evening peak inside the window and not outside', () => {
    // 2026-10-28 is a Wednesday.
    expect(ruleMatches(evening, input('2026-10-28T18:30:00Z'))).toBe(true);
    expect(ruleMatches(evening, input('2026-10-28T16:59:00Z'))).toBe(false);
    expect(ruleMatches(evening, input('2026-10-28T21:00:00Z'))).toBe(false); // end is exclusive
    expect(ruleMatches(evening, input('2026-10-31T18:30:00Z'))).toBe(false); // Saturday
  });

  it('handles windows that wrap midnight, attributing early hours to the previous day', () => {
    expect(ruleMatches(night, input('2026-10-28T23:00:00Z'))).toBe(true);
    expect(ruleMatches(night, input('2026-10-29T03:00:00Z'))).toBe(true);
    expect(ruleMatches(night, input('2026-10-29T06:00:00Z'))).toBe(false);
    // Friday 22:00-04:00 matches Saturday 02:00 but not Friday 02:00.
    expect(ruleMatches(fridayNight, input('2026-10-31T02:00:00Z'))).toBe(true); // Sat early morning
    expect(ruleMatches(fridayNight, input('2026-10-30T02:00:00Z'))).toBe(false); // Fri early morning (Thursday night)
    expect(ruleMatches(fridayNight, input('2026-10-30T23:00:00Z'))).toBe(true);
  });
});

describe('date rules', () => {
  it('matches yearly ranges that wrap the new year', () => {
    expect(ruleMatches(xmas, input('2027-12-25T10:00:00Z'))).toBe(true);
    expect(ruleMatches(xmas, input('2028-01-01T10:00:00Z'))).toBe(true);
    expect(ruleMatches(xmas, input('2027-01-02T10:00:00Z'))).toBe(false);
    expect(ruleMatches(xmas, input('2027-12-23T10:00:00Z'))).toBe(false);
  });

  it('scopes seasonal rules to a category', () => {
    expect(ruleMatches(rainyRoofing, input('2027-07-10T10:00:00Z'))).toBe(false); // electrical
    expect(ruleMatches(rainyRoofing, input('2027-07-10T10:00:00Z', { categoryIds: ['cat-roofing'] }))).toBe(true);
    expect(ruleMatches(rainyRoofing, input('2027-10-10T10:00:00Z', { categoryIds: ['cat-roofing'] }))).toBe(false);
  });
});

describe('computePrice', () => {
  it('charges the base price off-peak', () => {
    const r = computePrice(input('2026-10-28T10:00:00Z'), [evening, night], guard);
    expect(r).toMatchObject({ subtotalMinor: 25000, surchargeMinor: 0, totalMinor: 25000, multiplier: 1, isPeak: false });
  });

  it('applies a single peak rule with a customer-facing label', () => {
    const r = computePrice(input('2026-10-28T18:00:00Z'), [evening, night], guard);
    expect(r.surchargeMinor).toBe(6300); // 25% of Le 250 = Le 62.50, rounded to Le 63
    expect(r.totalMinor).toBe(31300);
    expect(r.lines[1].label).toBe('Evening peak');
  });

  it('picks the highest-priority non-stackable rule', () => {
    const r = computePrice(input('2027-12-25T18:00:00Z'), [evening, xmas], guard); // Christmas, a Saturday evening
    expect(r.appliedRules.map((a) => a.id)).toEqual(['xmas']);
    const wed = computePrice(input('2026-12-30T18:00:00Z'), [evening, xmas], guard); // Wednesday in the holiday period
    expect(wed.appliedRules.map((a) => a.id)).toEqual(['xmas']); // priority 15 beats evening's 10
  });

  it('stacks urgent and demand modifiers on top and adds flat fees', () => {
    const r = computePrice(input('2026-10-28T18:00:00Z', { isEmergency: true, demandRatio: 1 }), [evening, urgent, demand], guard);
    expect(r.appliedRules.map((a) => a.id)).toEqual(['evening', 'urgent']);
    expect(r.multiplier).toBe(1.5); // 1.25 * 1.2
    expect(r.surchargeMinor).toBe(12500 + 10000); // 50% + Le 100 flat
  });

  it('caps the combined multiplier', () => {
    const r = computePrice(input('2026-10-28T23:00:00Z', { isEmergency: true, demandRatio: 3 }), [night, urgent, demand], guard);
    // 1.5 * 1.2 * 1.2 = 2.16, capped to 1.75
    expect(r.multiplier).toBe(1.75);
    expect(r.cappedBy).toBe('max_multiplier');
    expect(r.surchargeMinor).toBe(18800 + 5000 + 10000); // 75% of 25000 rounded + flat fees
  });

  it('caps the absolute surcharge', () => {
    const r = computePrice(input('2026-10-28T18:00:00Z', { unitPriceMinor: 1_000_000 }), [evening], { maxMultiplier: 2, maxSurchargeMinor: 100_000 });
    expect(r.surchargeMinor).toBe(100_000);
    expect(r.cappedBy).toBe('max_surcharge');
  });

  it('respects quantity and rounds to whole Leones', () => {
    const r = computePrice(input('2026-10-28T10:00:00Z', { unitPriceMinor: 9050, quantity: 3 }), [], guard);
    expect(r.subtotalMinor).toBe(27200); // Le 271.50 -> Le 272
  });

  it('ignores inactive rules and rules for other zones', () => {
    const other = rule({ ...evening, id: 'other', zone_id: 'zone-2' });
    const off = rule({ ...evening, id: 'off', active: false });
    expect(computePrice(input('2026-10-28T18:00:00Z'), [other, off], guard).surchargeMinor).toBe(0);
  });
});
