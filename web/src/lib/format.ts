// Display helpers for Sierra Leone: Leones, local phone numbers, Freetown time (UTC+0 all year).

/** Formats integer minor units as "Le 1,250" (or "Le 1,250.50" when there are cents). */
export function le(minor: number | null | undefined): string {
  if (minor == null || Number.isNaN(Number(minor))) return '–';
  const v = Number(minor) / 100;
  const neg = v < 0;
  const abs = Math.abs(v);
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
  return `${neg ? '−' : ''}Le ${s}`;
}

/** Compact Leones for chart axes: Le 12.5k, Le 1.2M. */
export function leShort(minor: number): string {
  const v = minor / 100;
  if (Math.abs(v) >= 1_000_000) return `Le ${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1_000) return `Le ${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `Le ${v.toFixed(0)}`;
}

/** Leones (as typed by a person) to minor units. Returns null for blank/invalid input. */
export function toMinor(leones: string | number | null | undefined): number | null {
  if (leones === '' || leones == null) return null;
  const n = Number(String(leones).replace(/[,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function fromMinor(minor: number | null | undefined): string {
  if (minor == null) return '';
  const v = minor / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** Basis points to a percent string for inputs: 1250 -> "12.5". */
export function bpsToPct(bps: number | null | undefined): string {
  if (bps == null) return '';
  return String(Math.round(bps) / 100);
}

export function pctToBps(pct: string | number | null | undefined): number | null {
  if (pct === '' || pct == null) return null;
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function pct(bps: number | null | undefined): string {
  if (bps == null) return '–';
  return `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

/** Digits of a Sierra Leone mobile number in national form (0 + 8 digits) or null if not valid. */
export function normalizeLocalPhone(input: string): string | null {
  let d = input.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('232')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^\d{8}$/.test(d) ? `0${d}` : null;
}

/** Formats a number as the user types it: "076123456" -> "076 123 456". */
export function formatPhoneInput(input: string): string {
  const keepPlus = input.trim().startsWith('+');
  const d = input.replace(/\D/g, '');
  if (keepPlus || d.startsWith('232')) {
    const rest = d.slice(3);
    return `+232 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5, 8)}`.trim().replace(/\s+/g, ' ');
  }
  const x = d.slice(0, 9);
  return [x.slice(0, 3), x.slice(3, 6), x.slice(6, 9)].filter(Boolean).join(' ');
}

/** "+23276123456" -> "076 123 456". */
export function phone(e164: string | null | undefined): string {
  if (!e164) return '–';
  const n = normalizeLocalPhone(e164);
  return n ? formatPhoneInput(n) : e164;
}

const dtFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Freetown', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Freetown', day: 'numeric', month: 'short', year: 'numeric' });

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dtFmt.format(d);
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : dFmt.format(d);
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return '–';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const abs = Math.abs(diff);
  const fut = diff < 0;
  const f = (n: number, u: string) => (fut ? `in ${n} ${u}${n === 1 ? '' : 's'}` : `${n} ${u}${n === 1 ? '' : 's'} ago`);
  if (abs < 60) return fut ? 'in a moment' : 'just now';
  if (abs < 3600) return f(Math.round(abs / 60), 'min');
  if (abs < 86400) return f(Math.round(abs / 3600), 'hour');
  return f(Math.round(abs / 86400), 'day');
}

/** "in_progress" -> "In progress". */
export function humanize(s: string | null | undefined): string {
  if (!s) return '–';
  const t = s.replace(/[_.:]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function num(n: number | null | undefined): string {
  return n == null ? '–' : Number(n).toLocaleString('en-US');
}

/** Local date-time string for <input type="datetime-local"> in Freetown time (UTC+0). */
export function toLocalInput(d: Date): string {
  return d.toISOString().slice(0, 16);
}
