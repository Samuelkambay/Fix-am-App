export function le(minor: number | null | undefined): string {
  const v = (minor ?? 0) / 100;
  const whole = Number.isInteger(v);
  return `Le ${v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Accepts 076123456, 76 123 456 or +23276123456. Returns +232XXXXXXXX or null. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('232')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^\d{8}$/.test(d) ? `+232${d}` : null;
}

export function localPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const n = e164.replace(/^\+232/, '0');
  return n.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
}

const TZ = 'Africa/Freetown';
export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
}

export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${suffix}`;
}

/** YYYY-MM-DD in Freetown time, `offset` days from today. */
export function isoDate(offset = 0): string {
  const d = new Date(Date.now() + offset * 86400_000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

export function unitText(unit: string, label: string | null): string {
  if (unit === 'hourly') return '/ hour';
  if (unit === 'per_unit') return `/ ${label ?? 'unit'}`;
  return '';
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Finding a fixer',
  accepted: 'Fixer confirmed',
  assigned: 'Technician assigned',
  en_route: 'On the way',
  in_progress: 'Work in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'In dispute',
};

export const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash after the job',
  wallet: 'FixAm wallet',
  orange_money: 'Orange Money',
  afrimoney: 'Afrimoney',
  qmoney: 'QMoney',
  monime: 'Monime (any network)',
};

export const OPERATOR_LABEL: Record<string, string> = { orange: 'Orange', africell: 'Africell', qcell: 'Qcell' };

export const CATEGORY_ICON: Record<string, string> = {
  bolt: '⚡', droplet: '💧', sun: '☀️', snowflake: '❄️', hammer: '🔨', brick: '🧱', sparkles: '✨', flame: '🔥', tv: '📺',
};

export const BADGE_ICON: Record<string, string> = {
  PHONE_VERIFIED: '📱', NATIONAL_ID: '🪪', POLICE_CLEARANCE: '🛡️', TRADE_CERTIFIED: '🎓', BUSINESS_REGISTERED: '🏢',
  TOP_RATED: '⭐', RELIABLE: '⏱️', VETERAN: '🏆',
};

export const BADGE_SHORT: Record<string, string> = {
  PHONE_VERIFIED: 'Phone verified', NATIONAL_ID: 'ID verified', POLICE_CLEARANCE: 'Background checked', TRADE_CERTIFIED: 'Trade certified',
  BUSINESS_REGISTERED: 'Registered business', TOP_RATED: 'Top rated', RELIABLE: 'Reliable', VETERAN: '100 jobs',
};
