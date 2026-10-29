// Pure helpers shared by the apps: pricing strip, booking state rules, provider blockers, badges, time.
import { formatLe, formatMultiplier } from './money';
import type {
  AppliedRule, BadgeCode, Booking, BookingListItem, BookingStatus, DayCurveHour, PriceBreakdown, Role,
} from './types';

// ───────── Time (Sierra Leone is UTC+0 all year; Africa/Freetown has no DST) ─────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in Freetown time, `offsetDays` from today. */
export function freetownDate(offsetDays = 0, now = new Date()): string {
  const d = new Date(now.getTime() + offsetDays * 86400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "10:00" */
export function formatTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "Thu 30 Oct" */
export function formatDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Thu 30 Oct, 10:00" */
export function formatDateTime(iso: string | Date): string {
  return `${formatDay(iso)}, ${formatTime(iso)}`;
}

/** "Thu 30 Oct 2027" */
export function formatLongDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${formatDay(d)} ${d.getUTCFullYear()}`;
}

/** 899_000 ms -> "14:59". */
export function formatCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

// ───────── Pricing ─────────

/** Hours still bookable: at least `leadMinutes` from now (the API rejects times in the past). */
export function bookableHours(hours: DayCurveHour[], now = new Date(), leadMinutes = 30): DayCurveHour[] {
  const min = now.getTime() + leadMinutes * 60_000;
  return hours.filter((h) => new Date(h.at).getTime() >= min);
}

export interface CurveSummary {
  hours: DayCurveHour[];
  cheapest: DayCurveHour | null;
  /** Saving of the cheapest bookable hour versus the dearest one, in minor units. */
  maxSavingMinor: number;
}

/**
 * The API flags `isCheapest` across the whole day (06:00-22:00), including hours already gone.
 * Recompute it over the hours that can still be booked so we never suggest a time in the past.
 */
export function summariseCurve(all: DayCurveHour[], now = new Date()): CurveSummary {
  const hours = bookableHours(all, now);
  if (!hours.length) return { hours, cheapest: null, maxSavingMinor: 0 };
  const min = Math.min(...hours.map((h) => h.totalMinor));
  const max = Math.max(...hours.map((h) => h.totalMinor));
  const flagged = hours.map((h) => ({ ...h, isCheapest: h.totalMinor === min }));
  return { hours: flagged, cheapest: flagged.find((h) => h.isCheapest) ?? null, maxSavingMinor: max - min };
}

/** How much the payer saves by moving from `selected` to the cheapest bookable hour (0 if already cheapest). */
export function savingVersus(summary: CurveSummary, selected: DayCurveHour | null): number {
  if (!summary.cheapest || !selected) return 0;
  return Math.max(0, selected.totalMinor - summary.cheapest.totalMinor);
}

/** "Evening peak +25%", "Urgent job +20% + Le 100". */
export function ruleLabel(r: AppliedRule): string {
  const parts = [r.label];
  if (r.multiplier !== 1) parts.push(formatMultiplier(r.multiplier));
  if (r.flatFeeMinor > 0) parts.push(`+ ${formatLe(r.flatFeeMinor)}`);
  return parts.join(' ');
}

export function peakLabels(b: PriceBreakdown | null | undefined): string[] {
  return (b?.appliedRules ?? []).map(ruleLabel);
}

// ───────── Bookings ─────────
export const STATUS_FLOW: BookingStatus[] = ['pending', 'accepted', 'assigned', 'en_route', 'in_progress', 'completed'];
export const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'accepted', 'assigned', 'en_route', 'in_progress', 'disputed'];

export function isActiveBooking(b: Pick<BookingListItem, 'status'>): boolean {
  return ACTIVE_STATUSES.includes(b.status);
}

export type StatusTone = 'info' | 'warn' | 'success' | 'danger' | 'neutral';

export function statusTone(s: BookingStatus): StatusTone {
  switch (s) {
    case 'pending':
      return 'warn';
    case 'completed':
      return 'success';
    case 'cancelled':
      return 'neutral';
    case 'disputed':
      return 'danger';
    default:
      return 'info';
  }
}

/** Customer can cancel before work starts. */
export function customerCanCancel(b: Pick<Booking, 'status'>): boolean {
  return ['pending', 'accepted', 'assigned', 'en_route'].includes(b.status);
}

/** Disputes: while in progress, or up to 72 h after completion. */
export function customerCanDispute(b: Pick<Booking, 'status' | 'completed_at'>, now = Date.now()): boolean {
  if (b.status === 'in_progress') return true;
  if (b.status !== 'completed') return false;
  return !b.completed_at || now - new Date(b.completed_at).getTime() <= 72 * 3600_000;
}

export function customerCanReview(b: Pick<Booking, 'status' | 'review_rating'>): boolean {
  return b.status === 'completed' && b.review_rating == null;
}

/** Mobile money / wallet bookings that still need paying. Cash is paid to the fixer. */
export function needsPayment(b: Pick<Booking, 'payment_method' | 'payment_status' | 'status'>): boolean {
  return b.payment_method !== 'cash' && ['unpaid', 'pending'].includes(b.payment_status) && b.status !== 'cancelled';
}

export type JobAction = 'accept' | 'assign' | 'en_route' | 'start' | 'complete' | 'withdraw';

/** Which buttons the Pro app shows for a job. Mirrors the server's TRANSITIONS and role checks. */
export function jobActions(b: Pick<Booking, 'status' | 'provider_id' | 'serviceman_id'>, me: { role: Role; providerId: string | null; servicemanId: string | null }): JobAction[] {
  const mineAsProvider = me.role === 'provider' && !!me.providerId && b.provider_id === me.providerId;
  const mineAsServiceman = me.role === 'serviceman' && !!me.servicemanId && b.serviceman_id === me.servicemanId;
  if (b.status === 'pending' && me.role === 'provider' && (!b.provider_id || mineAsProvider)) return ['accept'];
  if (!mineAsProvider && !mineAsServiceman) return [];
  const out: JobAction[] = [];
  switch (b.status) {
    case 'accepted':
      if (mineAsProvider) out.push('assign');
      out.push('en_route');
      break;
    case 'assigned':
      if (mineAsProvider) out.push('assign');
      out.push('en_route');
      break;
    case 'en_route':
      out.push('start');
      break;
    case 'in_progress':
      out.push('complete');
      break;
  }
  // The server only lets a serviceman act on en-route/start/complete when assigned; owners can always.
  if (mineAsProvider && ['accepted', 'assigned', 'en_route'].includes(b.status)) out.push('withdraw');
  return out;
}

// ───────── Provider blockers ─────────
export type Blocker =
  | { kind: 'missing_badge'; badge: BadgeCode; raw: string }
  | { kind: 'cash_limit'; raw: string }
  | { kind: 'pending'; raw: string }
  | { kind: 'suspended'; raw: string }
  | { kind: 'other'; raw: string };

/** Turns `accept_blockers` codes into something the UI can explain with a call to action. */
export function parseBlocker(raw: string): Blocker {
  if (raw.startsWith('missing_badge:')) return { kind: 'missing_badge', badge: raw.slice('missing_badge:'.length), raw };
  if (raw === 'cash_commission_limit_exceeded') return { kind: 'cash_limit', raw };
  if (raw === 'provider_pending') return { kind: 'pending', raw };
  if (raw === 'provider_suspended') return { kind: 'suspended', raw };
  return { kind: 'other', raw };
}

// ───────── Badges ─────────
/** Badges worth showing as trust chips, in the order customers care about. */
export const BADGE_ORDER: BadgeCode[] = [
  'NATIONAL_ID', 'POLICE_CLEARANCE', 'TRADE_CERTIFIED', 'BUSINESS_REGISTERED', 'TOP_RATED', 'RELIABLE', 'VETERAN', 'PHONE_VERIFIED',
];

export function sortBadges<T extends BadgeCode>(codes: T[]): T[] {
  const idx = (c: BadgeCode) => {
    const i = BADGE_ORDER.indexOf(c);
    return i === -1 ? 99 : i;
  };
  return [...codes].sort((a, b) => idx(a) - idx(b));
}

export function badgeTone(code: BadgeCode): 'verified' | 'performance' | 'basic' {
  if (['TOP_RATED', 'RELIABLE', 'VETERAN'].includes(code)) return 'performance';
  if (code === 'PHONE_VERIFIED') return 'basic';
  return 'verified';
}

export function isVerifiedProvider(badges: BadgeCode[]): boolean {
  return badges.includes('NATIONAL_ID');
}

// ───────── Ledger ─────────
const KNOWN_ENTRIES = [
  'topup', 'booking_payment', 'refund', 'job_earning', 'commission', 'commission_gst', 'cash_commission_due',
  'cash_settlement', 'payout', 'payout_fee', 'payout_reversal', 'settlement_reversal',
];

/** i18n key for a ledger entry type. */
export function entryKey(type: string): string {
  return KNOWN_ENTRIES.includes(type) ? `entry.${type}` : 'entry.other';
}
