// Peak-hour pricing engine. Pure functions only, so the rules can be unit tested and simulated from the admin panel.
import { roundToLeone } from '../../lib/money.js';
import { localParts, timeToMinutes } from '../../lib/time.js';

export type RuleKind = 'time_window' | 'holiday' | 'seasonal' | 'demand' | 'emergency';

export interface PricingRule {
  id: string;
  name: string;
  label: string;
  kind: RuleKind;
  zone_id: string | null;
  category_id: string | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  date_from: string | null;
  date_to: string | null;
  recurring_yearly: boolean;
  min_demand_ratio: number | null;
  multiplier: number;
  flat_fee_minor: number;
  stackable: boolean;
  priority: number;
  active: boolean;
}

export interface PriceInput {
  unitPriceMinor: number;
  quantity: number;
  zoneId: string;
  /** The service's category and its parent, so a rule on "Electrical" also covers "Electrical > Wiring". */
  categoryIds: string[];
  scheduledAt: Date;
  isEmergency: boolean;
  /** Open requests per available provider around the scheduled time in this zone. */
  demandRatio: number;
}

export interface Guardrails {
  maxMultiplier: number;
  maxSurchargeMinor: number | null;
}

export interface AppliedRule {
  id: string;
  label: string;
  kind: RuleKind;
  multiplier: number;
  flatFeeMinor: number;
  stacked: boolean;
}

export interface PriceResult {
  subtotalMinor: number;
  multiplier: number;
  surchargeMinor: number;
  totalMinor: number;
  appliedRules: AppliedRule[];
  cappedBy: 'max_multiplier' | 'max_surcharge' | null;
  isPeak: boolean;
  lines: { label: string; amountMinor: number }[];
}

const dateToMd = (d: string) => d.slice(5, 10);

function inDateRange(rule: PricingRule, date: string): boolean {
  if (!rule.date_from && !rule.date_to) return true;
  if (!rule.recurring_yearly) {
    return (!rule.date_from || date >= rule.date_from) && (!rule.date_to || date <= rule.date_to);
  }
  // Yearly ranges compare month-day and may wrap the new year (e.g. 20 Dec - 2 Jan).
  const md = dateToMd(date);
  const from = rule.date_from ? dateToMd(rule.date_from) : '01-01';
  const to = rule.date_to ? dateToMd(rule.date_to) : '12-31';
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

function inTimeWindow(rule: PricingRule, at: Date): boolean {
  const { dayOfWeek, minutes } = localParts(at);
  const days = rule.days_of_week && rule.days_of_week.length ? rule.days_of_week : null;
  if (!rule.start_time || !rule.end_time) return !days || days.includes(dayOfWeek);
  const start = timeToMinutes(rule.start_time);
  const end = timeToMinutes(rule.end_time);
  if (start <= end) return minutes >= start && minutes < end && (!days || days.includes(dayOfWeek));
  // Window wraps midnight (e.g. 21:00-06:00). The early-morning part belongs to the previous day's window,
  // so "Friday night 21:00-06:00" also matches Saturday 02:00.
  if (minutes >= start) return !days || days.includes(dayOfWeek);
  if (minutes < end) return !days || days.includes((dayOfWeek + 6) % 7);
  return false;
}

export function ruleMatches(rule: PricingRule, input: PriceInput): boolean {
  if (!rule.active) return false;
  if (rule.zone_id && rule.zone_id !== input.zoneId) return false;
  if (rule.category_id && !input.categoryIds.includes(rule.category_id)) return false;
  if (rule.kind === 'emergency' && !input.isEmergency) return false;
  if (rule.kind === 'demand' && (rule.min_demand_ratio == null || input.demandRatio < rule.min_demand_ratio)) return false;
  if (!inDateRange(rule, localParts(input.scheduledAt).date)) return false;
  if (!inTimeWindow(rule, input.scheduledAt)) return false;
  return true;
}

/**
 * Combination policy:
 *  1. Of the matching non-stackable rules, the one with the highest priority wins (ties go to the higher multiplier).
 *  2. Matching stackable rules multiply on top of it and add their flat fees.
 *  3. The combined multiplier is capped at maxMultiplier, then the total surcharge at maxSurchargeMinor.
 *  4. Customer-facing amounts are rounded to whole Leones.
 */
export function computePrice(input: PriceInput, rules: PricingRule[], guard: Guardrails): PriceResult {
  const subtotalMinor = roundToLeone(Math.round(input.unitPriceMinor * input.quantity));
  const matched = rules.filter((r) => ruleMatches(r, input));

  const base = matched
    .filter((r) => !r.stackable)
    .sort((a, b) => b.priority - a.priority || b.multiplier - a.multiplier)[0];
  const stacked = matched.filter((r) => r.stackable).sort((a, b) => b.priority - a.priority);

  const applied: AppliedRule[] = [];
  let multiplier = 1;
  let flatFees = 0;
  for (const r of base ? [base, ...stacked] : stacked) {
    multiplier *= r.multiplier;
    flatFees += r.flat_fee_minor;
    applied.push({ id: r.id, label: r.label, kind: r.kind, multiplier: r.multiplier, flatFeeMinor: r.flat_fee_minor, stacked: r.stackable });
  }

  let cappedBy: PriceResult['cappedBy'] = null;
  if (multiplier > guard.maxMultiplier) {
    multiplier = guard.maxMultiplier;
    cappedBy = 'max_multiplier';
  }
  multiplier = Math.round(multiplier * 1000) / 1000;

  let surchargeMinor = roundToLeone(Math.round(subtotalMinor * (multiplier - 1)) + flatFees);
  if (guard.maxSurchargeMinor != null && surchargeMinor > guard.maxSurchargeMinor) {
    surchargeMinor = guard.maxSurchargeMinor;
    cappedBy = 'max_surcharge';
  }

  const lines = [{ label: 'Service', amountMinor: subtotalMinor }];
  if (surchargeMinor > 0) {
    lines.push({ label: applied.map((a) => a.label).join(' + ') || 'Peak surcharge', amountMinor: surchargeMinor });
  }

  return {
    subtotalMinor,
    multiplier,
    surchargeMinor,
    totalMinor: subtotalMinor + surchargeMinor,
    appliedRules: applied,
    cappedBy,
    isPeak: surchargeMinor > 0,
    lines,
  };
}
