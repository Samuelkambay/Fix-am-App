import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { BADGE_ICON, BADGE_SHORT, le } from '../lib/format';
import type { PriceBreakdown } from '../api/types';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{error.message}</span>
      {onRetry && (
        <button className="btn btn-sm btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function BadgeChip({ code, label }: { code: string; label?: string }) {
  const perf = ['TOP_RATED', 'RELIABLE', 'VETERAN'].includes(code);
  return (
    <span className={`chip ${perf ? 'chip-gold' : 'chip-green'}`} title={label ?? BADGE_SHORT[code]}>
      <span aria-hidden>{BADGE_ICON[code] ?? '✔'}</span> {label ?? BADGE_SHORT[code] ?? code}
    </span>
  );
}

export function BadgeChips({ codes, max = 4 }: { codes: string[]; max?: number }) {
  const shown = codes.filter((c) => c !== 'PHONE_VERIFIED').slice(0, max);
  if (!shown.length) return <span className="muted small">Phone verified</span>;
  return (
    <div className="chips">
      {shown.map((c) => (
        <BadgeChip key={c} code={c} />
      ))}
    </div>
  );
}

export function Stars({ value, count }: { value: number; count?: number }) {
  if (!count) return <span className="muted small">New on FixAm</span>;
  return (
    <span className="stars" aria-label={`${value} out of 5`}>
      ★ {Number(value).toFixed(1)} <span className="muted">({count})</span>
    </span>
  );
}

export function Breakdown({ breakdown, total, compact }: { breakdown: PriceBreakdown; total: number; compact?: boolean }) {
  return (
    <div className={`breakdown ${compact ? 'breakdown-compact' : ''}`}>
      {breakdown.lines.map((l, i) => (
        <div className={`row ${i > 0 ? 'row-peak' : ''}`} key={i}>
          <span>{i > 0 ? `⏰ ${l.label}` : l.label}</span>
          <span>{i > 0 ? '+' : ''}{le(l.amountMinor)}</span>
        </div>
      ))}
      {breakdown.appliedRules.length > 0 && !compact && (
        <div className="small muted">
          {breakdown.appliedRules.map((r) => `${r.label} ×${r.multiplier}${r.flatFeeMinor ? ` + ${le(r.flatFeeMinor)}` : ''}`).join(' · ')}
          {breakdown.cappedBy ? ' · capped for fairness' : ''}
        </div>
      )}
      <div className="row row-total">
        <span>Total</span>
        <span>{le(total)}</span>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
