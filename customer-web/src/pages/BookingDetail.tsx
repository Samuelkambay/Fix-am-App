import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Booking } from '../api/types';
import { PaymentFlow } from '../components/PaymentFlow';
import { Breakdown, ErrorBox, Spinner, Stars } from '../components/ui';
import { le, localPhone, METHOD_LABEL, STATUS_LABEL, when } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useAsync } from '../lib/useAsync';

const FLOW = ['pending', 'accepted', 'en_route', 'in_progress', 'completed'] as const;
const ACTIVE = ['pending', 'accepted', 'assigned', 'en_route', 'in_progress'];

function Progress({ status }: { status: string }) {
  const idx = FLOW.indexOf((status === 'assigned' ? 'accepted' : status) as (typeof FLOW)[number]);
  if (idx < 0) return null;
  return (
    <ol className="progress">
      {FLOW.map((s, i) => (
        <li key={s} className={i < idx ? 'done' : i === idx ? 'current' : ''}>
          <span className="progress-dot" />
          <span className="progress-label">{STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

function CodeCard({ label, code, help }: { label: string; code: string; help: string }) {
  return (
    <div className="code-card">
      <div className="small">{label}</div>
      <div className="code-digits" aria-label={code.split('').join(' ')}>
        {code.split('').map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="small">{help}</div>
    </div>
  );
}

function ReviewForm({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div className="card stack">
      <h3>How did it go?</h3>
      <div className="rate" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)} aria-label={`${n} stars`}>
            ★
          </button>
        ))}
      </div>
      <textarea className="input" rows={2} placeholder="Tell others about the work (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <ErrorBox error={error} />
      <button
        className="btn btn-primary"
        disabled={!rating}
        onClick={async () => {
          try {
            await api('/reviews', { body: { bookingId, rating, comment: comment || undefined } });
            onDone();
          } catch (e) {
            setError(e as ApiError);
          }
        }}
      >
        Submit review
      </button>
    </div>
  );
}

function ReasonAction({ label, danger, placeholder, onSubmit }: { label: string; danger?: boolean; placeholder: string; onSubmit: (r: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  if (!open)
    return (
      <button className={`btn ${danger ? 'btn-danger-ghost' : 'btn-ghost'}`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div className="card stack">
      <textarea className="input" rows={2} placeholder={placeholder} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      <ErrorBox error={error} />
      <div className="btn-row">
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          disabled={reason.trim().length < 5}
          onClick={async () => {
            try {
              await onSubmit(reason.trim());
              setOpen(false);
            } catch (e) {
              setError(e as ApiError);
            }
          }}
        >
          {label}
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Back
        </button>
      </div>
    </div>
  );
}

export default function BookingDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { t } = useI18n();
  const { data: b, error, loading, reload } = useAsync(() => api<Booking>(`/bookings/${id}`), [id]);
  const [paying, setPaying] = useState(params.get('pay') === '1');

  // Keep the status fresh while the job is moving.
  useEffect(() => {
    if (!b || !ACTIVE.includes(b.status)) return;
    const timer = setInterval(() => reload(true), 10000);
    return () => clearInterval(timer);
  }, [b, reload]);

  if (loading && !b) return <Spinner />;
  if (!b) return <ErrorBox error={error} onRetry={() => reload()} />;

  const canPay = b.payment_method !== 'cash' && ['unpaid', 'pending'].includes(b.payment_status) && b.status !== 'cancelled';
  const canCancel = ['pending', 'accepted', 'assigned', 'en_route'].includes(b.status);
  const canDispute = b.status === 'in_progress' || (b.status === 'completed' && b.completed_at && Date.now() - new Date(b.completed_at).getTime() < 72 * 3600_000);

  return (
    <div className="two-col">
      <div className="stack">
        <div>
          <Link to="/bookings" className="crumb">
            ← My bookings
          </Link>
          <div className="row-between">
            <h1>{b.service_name}</h1>
            <span className={`status status-${b.status}`}>{STATUS_LABEL[b.status]}</span>
          </div>
          <p className="muted">
            {b.code} · {when(b.scheduled_at)} {b.is_emergency && '· 🚨 urgent'}
          </p>
        </div>

        <Progress status={b.status} />
        {b.status === 'cancelled' && <div className="alert alert-error">Cancelled{b.cancel_reason ? `: ${b.cancel_reason}` : ''}. {b.payment_status === 'refunded' && 'Your money is back in your FixAm wallet.'}</div>}
        {b.status === 'disputed' && <div className="alert alert-warn">Our team is looking into this job and will call you.</div>}

        {b.start_code && ['accepted', 'assigned', 'en_route', 'pending'].includes(b.status) && (
          <CodeCard label={t('startCode')} code={b.start_code} help="Give this code to the fixer only when they arrive at your home." />
        )}
        {b.completion_code && b.status === 'in_progress' && (
          <CodeCard label={t('completionCode')} code={b.completion_code} help="Give this code only when the work is finished and you're happy with it." />
        )}

        {paying && canPay && (
          <PaymentFlow
            target={{ purpose: 'booking', bookingId: b.id, amountMinor: b.total_minor }}
            onPaid={() => {
              setParams({}, { replace: true });
              setTimeout(() => {
                setPaying(false);
                reload(true);
              }, 1500);
            }}
          />
        )}

        <section className="card stack">
          <h3>Your fixer</h3>
          {b.provider_name ? (
            <div className="pro-row">
              <div className="pro-avatar" aria-hidden>
                {b.provider_name.slice(0, 1)}
              </div>
              <div className="grow">
                <Link to={`/providers/${b.provider_id}`}>
                  <b>{b.provider_name}</b>
                </Link>
                <div>{b.provider_rating != null && <Stars value={b.provider_rating} count={1} />}</div>
                {b.serviceman_name && <div className="small">Technician: {b.serviceman_name}</div>}
              </div>
              {(b.serviceman_phone || b.provider_phone) && ACTIVE.includes(b.status) && (
                <a className="btn btn-outline" href={`tel:${b.serviceman_phone ?? b.provider_phone}`}>
                  📞 Call
                </a>
              )}
            </div>
          ) : (
            <p className="muted">We've sent your job to verified fixers nearby. You'll get an SMS when one accepts.</p>
          )}
          <div className="small muted">
            📍 {b.address.area} · {b.address.landmark}
            {b.address.contactPhone && ` · ${localPhone(b.address.contactPhone)}`}
          </div>
          <Link to="/verify" className="small">
            🛡️ Check your fixer's badge code before you open the gate
          </Link>
        </section>

        <section className="card">
          <h3>Timeline</h3>
          <ul className="timeline">
            {b.events.map((e, i) => (
              <li key={i}>
                <span className="timeline-dot" />
                <div>
                  <b>{STATUS_LABEL[e.to_status] ?? e.to_status}</b>
                  {e.note && <span className="muted"> · {e.note}</span>}
                  <div className="small muted">{when(e.created_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {b.status === 'completed' && b.review_rating == null && <ReviewForm bookingId={b.id} onDone={() => reload(true)} />}
        {b.review_rating != null && <p className="muted">You rated this job {'★'.repeat(b.review_rating)}. Tenki!</p>}
      </div>

      <aside className="sticky stack">
        <div className="card stack">
          <h3>Payment</h3>
          <Breakdown breakdown={b.price_breakdown} total={b.total_minor} compact />
          <div className="row-between small">
            <span>{METHOD_LABEL[b.payment_method]}</span>
            <span className={`pay pay-${b.payment_status}`}>{b.payment_status}</span>
          </div>
          {canPay && !paying && (
            <button className="btn btn-primary btn-block" onClick={() => setPaying(true)}>
              Pay {le(b.total_minor)} now
            </button>
          )}
          {b.payment_method === 'cash' && b.status !== 'cancelled' && b.status !== 'completed' && (
            <p className="small muted">Pay the fixer in cash when the work is done.</p>
          )}
        </div>
        {canCancel && (
          <ReasonAction
            label="Cancel booking"
            danger
            placeholder="Why are you cancelling?"
            onSubmit={async (reason) => {
              await api(`/bookings/${b.id}/cancel`, { body: { reason } });
              reload(true);
            }}
          />
        )}
        {canDispute && (
          <ReasonAction
            label="Report a problem"
            placeholder="What went wrong?"
            onSubmit={async (reason) => {
              await api(`/bookings/${b.id}/dispute`, { body: { reason } });
              reload(true);
            }}
          />
        )}
      </aside>
    </div>
  );
}
