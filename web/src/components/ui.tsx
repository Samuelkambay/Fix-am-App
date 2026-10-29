// Small UI primitives shared by every page.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api';
import { bpsToPct, formatPhoneInput, fromMinor, humanize, pctToBps, toMinor } from '../lib/format';

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'secondary',
  size,
  busy,
  block,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm'; busy?: boolean; block?: boolean }) {
  const cls = ['btn', variant !== 'secondary' && `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={busy || rest.disabled} {...rest}>
      {busy && <span className="spinner" style={{ width: 14, height: 14 }} aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

/** Amount input in Leones. Value and onChange are in minor units (100 = Le 1). */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  allowEmpty = true,
  ...rest
}: { value: number | null | undefined; onChange: (minor: number | null) => void; allowEmpty?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(fromMinor(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(fromMinor(value));
      last.current = value;
    }
  }, [value]);
  return (
    <div className="input-affix">
      <span className="affix">Le</span>
      <input
        className="input num"
        inputMode="decimal"
        placeholder={placeholder ?? '0'}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '');
          setText(t);
          const m = toMinor(t);
          const next = m ?? (allowEmpty ? null : 0);
          last.current = next;
          onChange(next);
        }}
        {...rest}
      />
    </div>
  );
}

/** Percent input backed by basis points (12.5% <-> 1250 bps). */
export function PercentInput({
  value,
  onChange,
  placeholder,
  ...rest
}: { value: number | null | undefined; onChange: (bps: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(bpsToPct(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(bpsToPct(value));
      last.current = value;
    }
  }, [value]);
  return (
    <div className="input-affix">
      <input
        className="input num"
        inputMode="decimal"
        placeholder={placeholder ?? '0'}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, '');
          setText(t);
          const b = pctToBps(t);
          last.current = b;
          onChange(b);
        }}
        {...rest}
      />
      <span className="affix">%</span>
    </div>
  );
}

/** Accepts local Sierra Leone formats (076 123 456, +232 76 123 456) and formats as you type. */
export function PhoneInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      className="input num"
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="076 123 456"
      value={value}
      onChange={(e) => onChange(formatPhoneInput(e.target.value))}
      {...rest}
    />
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" aria-hidden />
      <span>{label ?? 'Loading…'}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>{errorMessage(error)}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** Renders loading / error / content for a useApi() state. */
export function Async<T>({ state, children, empty }: { state: { data: T | undefined; error: unknown; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty?: ReactNode }) {
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.data === undefined) return <Spinner />;
  if (empty && Array.isArray(state.data) && state.data.length === 0) return <>{empty}</>;
  return <>{children(state.data)}</>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, flush, className = '' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TONES: Record<string, 'good' | 'warn' | 'bad' | 'info' | ''> = {
  active: 'good', approved: 'good', completed: 'good', succeeded: 'good', paid: 'good', valid: 'good', sent: 'good',
  pending: 'warn', requested: 'warn', initiated: 'warn', pending_payment: 'warn', unpaid: 'warn', processing: 'info',
  accepted: 'info', assigned: 'info', en_route: 'info', in_progress: 'info',
  suspended: 'bad', rejected: 'bad', revoked: 'bad', failed: 'bad', cancelled: '', expired: '', disputed: 'bad', refunded: 'info', blocked: 'bad',
};

export function StatusPill({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <span className="pill">–</span>;
  const tone = TONES[status] ?? '';
  return <span className={`pill ${tone ? `pill-${tone}` : ''}`}>{label ?? humanize(status)}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'wide' | 'xwide';
}) {
  const id = useId();
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <Button variant="ghost" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  useEscape(onClose);
  return (
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <Button variant="ghost" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </aside>
    </div>
  );
}

function useEscape(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && ref.current();
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, []);
}

/** Asks for a line of text (a reason, a note, a reference) before running an action. */
export function PromptModal({
  title,
  label,
  hint,
  confirmLabel,
  danger,
  minLength = 0,
  multiline = true,
  initial = '',
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  label: string;
  hint?: string;
  confirmLabel: string;
  danger?: boolean;
  minLength?: number;
  multiline?: boolean;
  initial?: string;
  onSubmit: (text: string) => Promise<unknown>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const ok = text.trim().length >= minLength;
  const submit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await onSubmit(text.trim());
      onClose();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} disabled={!ok} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        {children}
        <Field label={label} hint={hint ?? (minLength ? `At least ${minLength} characters` : undefined)}>
          {multiline ? (
            <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && submit()} />
          )}
        </Field>
        {err !== undefined && <ErrorBox error={err} />}
      </div>
    </Modal>
  );
}

export function Kpi({ label, value, sub, attention, href }: { label: string; value: ReactNode; sub?: ReactNode; attention?: boolean; href?: string }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </>
  );
  if (href)
    return (
      <Link className={`kpi ${attention ? 'attention' : ''}`} to={href}>
        {body}
      </Link>
    );
  return <div className={`kpi ${attention ? 'attention' : ''}`}>{body}</div>;
}

/** Horizontal bar list for small categorical breakdowns (lighter than a chart library). */
export function BarList({ rows, format }: { rows: { label: string; value: number; extra?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <Empty title="No data for this period" />;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label} title={`${r.label}: ${format(r.value)}${r.extra ? ` · ${r.extra}` : ''}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, display: 'block' }} />
          </span>
          <span className="bar-value">
            {format(r.value)}
            {r.extra && <span className="cell-sub"> · {r.extra}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Pager({ offset, limit, count, onChange }: { offset: number; limit: number; count: number; onChange: (offset: number) => void }) {
  if (offset === 0 && count < limit) return null;
  return (
    <div className="row-between" style={{ padding: '10px 12px' }}>
      <span className="muted small">
        Showing {count ? offset + 1 : 0}–{offset + count}
      </span>
      <div className="row">
        <Button size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          ← Previous
        </Button>
        <Button size="sm" disabled={count < limit} onClick={() => onChange(offset + limit)}>
          Next →
        </Button>
      </div>
    </div>
  );
}
