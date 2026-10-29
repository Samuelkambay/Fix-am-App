// Money helpers. Amounts are integer minor units of the new Leone (SLE, 100 minor = Le 1).

/** Applies a rate in basis points (1 bps = 0.01%) and rounds half up to a whole minor unit. */
export function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
}

/** Rounds to the nearest whole Leone. Coins are rarely used, so customer prices are whole Leones. */
export function roundToLeone(amountMinor: number): number {
  return Math.round(amountMinor / 100) * 100;
}

export function formatLeone(amountMinor: number): string {
  const le = amountMinor / 100;
  return `Le ${le.toLocaleString('en-US', { minimumFractionDigits: le % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}
