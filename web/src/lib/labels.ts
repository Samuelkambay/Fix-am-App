import type { BookingStatus, Gateway, PaymentMethod } from '../api/types';
import { le } from './format';

export const GATEWAYS: { code: Gateway; name: string; network: string; operator: 'orange' | 'africell' | 'qcell' | null }[] = [
  { code: 'orange_money', name: 'Orange Money', network: 'Orange', operator: 'orange' },
  { code: 'afrimoney', name: 'Afrimoney', network: 'Africell', operator: 'africell' },
  { code: 'qmoney', name: 'QMoney', network: 'Qcell', operator: 'qcell' },
  { code: 'monime', name: 'Monime', network: 'Any network', operator: null },
];

const METHOD_NAMES: Record<string, string> = {
  cash: 'Cash',
  wallet: 'FixAm wallet',
  orange_money: 'Orange Money',
  afrimoney: 'Afrimoney',
  qmoney: 'QMoney',
  monime: 'Monime',
};

export function methodName(m: PaymentMethod | Gateway | string | null | undefined): string {
  if (!m) return '–';
  return METHOD_NAMES[m] ?? m;
}

export const BOOKING_STATUSES: BookingStatus[] = ['pending', 'accepted', 'assigned', 'en_route', 'in_progress', 'completed', 'disputed', 'cancelled'];

const BADGE_NAMES: Record<string, string> = {
  NATIONAL_ID: 'ID verified',
  POLICE_CLEARANCE: 'Background checked',
  TRADE_CERTIFIED: 'Trade certified',
  BUSINESS_REGISTERED: 'Registered business',
  PHONE_VERIFIED: 'Phone verified',
};

const BADGE_ACTION: Record<string, string> = {
  NATIONAL_ID: 'Upload your ID and a selfie to start accepting jobs',
  POLICE_CLEARANCE: 'Upload your police clearance certificate to start accepting jobs',
  TRADE_CERTIFIED: 'Upload your trade certificate to start accepting jobs',
  BUSINESS_REGISTERED: 'Upload your business registration and NRA tax certificate to start accepting jobs',
};

export interface BlockerInfo {
  text: string;
  action?: { label: string; to: string };
  tone: 'warning' | 'critical';
}

/** Turns an `accept_blockers` code from /providers/me into plain English with a next step. */
export function explainBlocker(code: string, ctx: { owedMinor: number; limitMinor: number }): BlockerInfo {
  if (code.startsWith('missing_badge:')) {
    const badge = code.slice('missing_badge:'.length);
    return {
      text: BADGE_ACTION[badge] ?? `Get the "${BADGE_NAMES[badge] ?? badge}" badge to start accepting jobs`,
      action: { label: 'Go to badges', to: '/provider/badges' },
      tone: 'warning',
    };
  }
  switch (code) {
    case 'cash_commission_limit_exceeded':
      return {
        text: `You owe ${le(ctx.owedMinor)} commission on cash jobs – pay now to accept new jobs (limit ${le(ctx.limitMinor)}).`,
        action: { label: 'Pay now', to: '/provider/wallet#settle' },
        tone: 'critical',
      };
    case 'provider_pending':
      return { text: 'Your account is waiting for FixAm approval. We will SMS you when it is approved.', tone: 'warning' };
    case 'provider_suspended':
      return { text: 'Your account is suspended. Call FixAm support to reactivate it.', tone: 'critical' };
    case 'provider_not_found':
      return { text: 'We could not find your provider account. Log out and log in again.', tone: 'critical' };
    default:
      return { text: code.replace(/_/g, ' '), tone: 'warning' };
  }
}

export const DOC_LABELS: Record<string, string> = {
  id_document: 'National ID, passport or voter ID',
  selfie: 'Selfie holding your ID',
  police_clearance: 'Police clearance certificate',
  trade_certificate: 'Trade certificate or association letter',
  business_registration: 'Business registration certificate',
  tax_certificate: 'NRA tax (TIN) certificate',
};

export function docLabel(t: string): string {
  return DOC_LABELS[t] ?? t.replace(/_/g, ' ');
}

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const RATE_SOURCE_LABELS: Record<string, string> = {
  provider_override: 'Negotiated rate',
  subscription: 'Subscription rate',
  category: 'Category rate',
  volume_tier: 'Volume tier',
  plan_default: 'Plan default',
};

export const ENTRY_LABELS: Record<string, string> = {
  job_earning: 'Job earning',
  cash_commission_due: 'Commission on cash job',
  cash_settlement: 'Commission paid',
  payout: 'Withdrawal',
  payout_fee: 'Withdrawal fee',
  payout_reversal: 'Withdrawal returned',
  settlement_reversal: 'Settlement reversed',
};
