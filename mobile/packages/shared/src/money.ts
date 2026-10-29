// Money is integer minor units of the new Leone (SLE): 100 minor = Le 1. Customer prices are whole Leones.

function group(n: number): string {
  // Manual grouping: Intl on low-end Android (Hermes without full ICU) is not always reliable.
  const [int, frac] = n.toFixed(2).split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac === '00' ? '' : `.${frac}`}`;
}

/** 125000 -> "Le 1,250"; 12550 -> "Le 125.50"; -5000 -> "-Le 50". */
export function formatLe(amountMinor: number | null | undefined): string {
  if (amountMinor == null || Number.isNaN(amountMinor)) return 'Le —';
  const le = Math.round(amountMinor) / 100;
  const s = group(Math.abs(le));
  return le < 0 ? `-Le ${s}` : `Le ${s}`;
}

/** With an explicit sign, for ledger lines: "+Le 212.50" / "-Le 37.50". */
export function formatLeSigned(amountMinor: number): string {
  if (amountMinor > 0) return `+${formatLe(amountMinor)}`;
  return formatLe(amountMinor);
}

/** Parses what a user types ("1,250", "Le 1250", "1250.5") into minor units. Returns null if invalid. */
export function parseLeToMinor(input: string): number | null {
  const cleaned = input.replace(/le/i, '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** 1.25 -> "+25%". */
export function formatMultiplier(multiplier: number): string {
  const pct = Math.round((multiplier - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

/** 1500 bps -> "15%"; 1250 -> "12.5%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}
