import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Booking, PaymentMethods } from '../api/types';
import { Breakdown, Empty, ErrorBox, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { le, localPhone, METHOD_LABEL, OPERATOR_LABEL, when } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { shortZone } from '../lib/zone';
import { CHECKOUT_KEY, type PendingCheckout } from './Service';

function useCountdown(until: string | undefined) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

export default function Checkout() {
  const nav = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  const [pending] = useState<PendingCheckout | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) ?? 'null');
    } catch {
      return null;
    }
  });
  const [area, setArea] = useState(pending ? shortZone(pending.zoneName) : '');
  const [landmark, setLandmark] = useState('');
  const [street, setStreet] = useState('');
  const [contact, setContact] = useState(localPhone(user?.phone));
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<string>('');
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(pending?.quote.expires_at);

  useEffect(() => {
    api<PaymentMethods>('/payments/methods', { query: { msisdn: user?.phone } })
      .then((m) => {
        setMethods(m);
        setMethod(m.suggested ?? 'cash');
      })
      .catch(setError);
  }, [user?.phone]);

  if (!pending) {
    return (
      <Empty icon="🧾" title="Nothing to check out">
        <Link to="/" className="btn btn-primary">
          Find a service
        </Link>
      </Empty>
    );
  }
  const q = pending.quote;
  const expired = left === 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const b = await api<Booking>('/bookings', {
        body: {
          quoteId: q.id,
          paymentMethod: method,
          notes: notes || undefined,
          address: { area, landmark, street: street || undefined, contactPhone: contact || undefined },
        },
      });
      sessionStorage.removeItem(CHECKOUT_KEY);
      nav(`/bookings/${b.id}${method === 'cash' ? '' : '?pay=1'}`, { replace: true });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const groups = [
    { title: 'Mobile money', items: (methods?.methods ?? []).filter((m) => m.type === 'mobile_money') },
    { title: 'Other', items: (methods?.methods ?? []).filter((m) => m.type !== 'mobile_money') },
  ];

  return (
    <div className="two-col">
      <div className="stack">
        <h1>Confirm your booking</h1>
        <section className="card stack">
          <h3>Where?</h3>
          <Field label={t('area')}>
            <input className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Kissy Mess Mess" />
          </Field>
          <Field label={t('landmark')} hint="Most homes have no street address. Tell the fixer what to look for.">
            <input className="input" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="e.g. Behind the Total station, blue gate" />
          </Field>
          <Field label="Street (optional)">
            <input className="input" value={street} onChange={(e) => setStreet(e.target.value)} />
          </Field>
          <Field label="Phone the fixer should call">
            <input className="input" inputMode="tel" value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field label="What's the problem? (optional)">
            <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Kitchen sockets stopped working after the rain" />
          </Field>
        </section>

        <section className="card stack">
          <h3>{t('payWith')}</h3>
          {groups.map((g) =>
            g.items.length ? (
              <div key={g.title} className="stack-sm">
                <div className="muted small">{g.title}</div>
                <div className="method-grid">
                  {g.items.map((m) => {
                    const wrongNet = m.operator && methods?.operator && methods.operator !== 'unknown' && m.operator !== methods.operator;
                    return (
                      <button
                        key={m.code}
                        className={`method method-${m.code} ${method === m.code ? 'selected' : ''}`}
                        onClick={() => setMethod(m.code)}
                        role="radio"
                        aria-checked={method === m.code}
                      >
                        <span className="method-logo" aria-hidden />
                        <span>{METHOD_LABEL[m.code] ?? m.name}</span>
                        {methods?.suggested === m.code && <span className="tag">Your network</span>}
                        {wrongNet && <span className="tag tag-muted">Other network</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null,
          )}
          {method === 'cash' && <p className="small muted">Pay the fixer when the job is done. Don't pay before the work starts.</p>}
          {method !== 'cash' && method && (
            <p className="small muted">
              You'll approve the payment on your phone next.
              {methods?.operator && methods.operator !== 'unknown' && ` Your number is on ${OPERATOR_LABEL[methods.operator]}.`} If the job is cancelled, the
              money goes back to your FixAm wallet straight away.
            </p>
          )}
        </section>
      </div>

      <aside className="sticky">
        <div className="card stack">
          <h3>{pending.service.name}</h3>
          <div className="muted small">
            {q.is_emergency ? '🚨 Urgent · ' : ''}
            {when(q.scheduled_at)} · {shortZone(pending.zoneName)}
            {pending.providerName ? ` · ${pending.providerName}` : ' · any verified fixer'}
            {Number(q.quantity) > 1 ? ` · ×${q.quantity}` : ''}
          </div>
          <Breakdown breakdown={q.breakdown} total={q.total_minor} />
          <div className={`lock ${expired ? 'expired' : ''}`}>
            {expired ? '⌛ Price expired. Go back to get a new price.' : `🔒 Price locked for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
          </div>
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-block btn-lg" disabled={busy || expired || area.trim().length < 2 || landmark.trim().length < 2 || !method} onClick={confirm}>
            {busy ? 'Booking…' : `${t('confirm')} · ${le(q.total_minor)}`}
          </button>
          {expired && (
            <button className="btn btn-ghost btn-block" onClick={() => nav(-1)}>
              Get a new price
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
