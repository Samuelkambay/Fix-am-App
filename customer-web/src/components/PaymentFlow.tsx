import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, newIdempotencyKey } from '../api/client';
import type { Payment, PaymentMethods } from '../api/types';
import { useAuth } from '../lib/auth';
import { le, localPhone, METHOD_LABEL, normalizePhone, OPERATOR_LABEL } from '../lib/format';
import { ErrorBox } from './ui';

type Target = { purpose: 'booking'; bookingId: string; amountMinor: number } | { purpose: 'wallet_topup'; amountMinor: number };

const FAILURE_TEXT: Record<string, string> = {
  insufficient_funds: 'Not enough money in the wallet.',
  payer_did_not_approve: 'The payment was not approved in time.',
  declined_by_payer: 'The payment was declined on the phone.',
  gateway_error: 'The mobile money service did not respond.',
};

/**
 * Mobile money checkout: pick a wallet → the operator prompts the payer's phone → poll until final.
 * One Idempotency-Key per attempt, reused on network retries so a flaky connection never charges twice.
 */
export function PaymentFlow({ target, allowWallet = true, onPaid }: { target: Target; allowWallet?: boolean; onPaid: (p: Payment) => void }) {
  const { user } = useAuth();
  const [msisdn, setMsisdn] = useState(localPhone(user?.phone));
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [gateway, setGateway] = useState<string>('');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string>(newIdempotencyKey());

  const e164 = normalizePhone(msisdn);
  useEffect(() => {
    api<PaymentMethods>('/payments/methods', { query: { msisdn: e164 ?? undefined } })
      .then((m) => {
        setMethods(m);
        setGateway((g) => g || m.suggested || 'orange_money');
      })
      .catch((e) => setError(e));
  }, [e164]);

  const options = useMemo(
    () => (methods?.methods ?? []).filter((m) => m.type === 'mobile_money' || (allowWallet && m.type === 'wallet')),
    [methods, allowWallet],
  );
  const selected = options.find((o) => o.code === gateway);
  const mismatch =
    selected?.operator && methods?.operator && methods.operator !== 'unknown' && selected.operator !== methods.operator
      ? `${localPhone(e164)} is an ${OPERATOR_LABEL[methods.operator]} number. Use ${METHOD_LABEL[methods.suggested ?? ''] ?? 'another wallet'} or a different number.`
      : null;

  // Poll while the payer approves on their handset.
  useEffect(() => {
    if (!payment || payment.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const p = await api<Payment>(`/payments/${payment.id}`);
        setPayment(p);
        if (p.status === 'succeeded') onPaid(p);
      } catch {
        /* keep polling through blips */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [payment, onPaid]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const body =
        target.purpose === 'booking'
          ? { purpose: 'booking', bookingId: target.bookingId, gateway, msisdn: e164 ?? undefined }
          : { purpose: 'wallet_topup', amountMinor: target.amountMinor, gateway, msisdn: e164 };
      const p = await api<Payment>('/payments', { body, headers: { 'Idempotency-Key': keyRef.current } });
      setPayment(p);
      if (p.status === 'succeeded') onPaid(p);
    } catch (e) {
      const err = e as ApiError;
      // Network failures keep the same key so the retry is safe; anything else starts a fresh attempt.
      if (err.code !== 'network_error') keyRef.current = newIdempotencyKey();
      if (err.code === 'payment_in_progress' && err.details?.paymentId) {
        setPayment(await api<Payment>(`/payments/${err.details.paymentId}`));
      } else setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function simulate(outcome: 'succeeded' | 'failed') {
    if (!payment) return;
    try {
      const r = await api<{ payment: Payment }>(`/payments/${payment.id}/simulate`, { body: { outcome } });
      setPayment(r.payment);
      if (r.payment.status === 'succeeded') onPaid(r.payment);
    } catch (e) {
      setError(e as ApiError);
    }
  }

  function retry() {
    keyRef.current = newIdempotencyKey();
    setPayment(null);
  }

  if (payment && payment.status !== 'initiated') {
    const a = payment.customer_action;
    return (
      <div className="card pay-status" data-testid="payment-status">
        {payment.status === 'pending' && (
          <>
            <div className="pulse" aria-hidden>📲</div>
            <h3>Waiting for approval</h3>
            <p className="lead">{a?.message ?? 'Approve the payment on your phone.'}</p>
            {a?.paymentCode && (
              <div className="code-box">
                <span className="small muted">Payment code</span>
                <span className="code">{a.paymentCode}</span>
              </div>
            )}
            {a?.redirectUrl && (
              <a className="btn btn-primary btn-block" href={a.redirectUrl} target="_blank" rel="noreferrer">
                Open payment page
              </a>
            )}
            <p className="small muted">This page updates by itself. Don't pay twice.</p>
            {options.find((o) => o.code === payment.gateway)?.sandbox && (
              <div className="sandbox">
                <span className="small">Sandbox mode, no real money</span>
                <div className="btn-row">
                  <button className="btn btn-sm btn-primary" onClick={() => simulate('succeeded')}>
                    Simulate approval
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => simulate('failed')}>
                    Simulate decline
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {payment.status === 'succeeded' && (
          <>
            <div className="big-icon ok" aria-hidden>✓</div>
            <h3>Paid {le(payment.amount_minor)}</h3>
            <p className="muted">via {METHOD_LABEL[payment.gateway] ?? payment.gateway}</p>
          </>
        )}
        {['failed', 'expired'].includes(payment.status) && (
          <>
            <div className="big-icon bad" aria-hidden>!</div>
            <h3>Payment did not go through</h3>
            <p className="muted">{FAILURE_TEXT[payment.failure_reason ?? ''] ?? payment.failure_reason ?? 'It expired before it was approved.'}</p>
            <button className="btn btn-primary btn-block" onClick={retry}>
              Try again or use another wallet
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Pay {le(target.amountMinor)}</h3>
      <label className="field">
        <span className="field-label">Mobile money number</span>
        <input className="input" inputMode="tel" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="076 123 456" />
        {methods?.operator && methods.operator !== 'unknown' && <span className="field-hint">{OPERATOR_LABEL[methods.operator]} number</span>}
      </label>
      <div className="method-grid" role="radiogroup" aria-label="Wallet">
        {options.map((o) => (
          <button
            key={o.code}
            role="radio"
            aria-checked={gateway === o.code}
            className={`method method-${o.code} ${gateway === o.code ? 'selected' : ''}`}
            onClick={() => setGateway(o.code)}
          >
            <span className="method-logo" aria-hidden />
            <span>{METHOD_LABEL[o.code] ?? o.name}</span>
            {methods?.suggested === o.code && <span className="tag">Your network</span>}
          </button>
        ))}
      </div>
      {mismatch && <div className="alert alert-warn">{mismatch}</div>}
      <ErrorBox error={error} />
      <button className="btn btn-primary btn-block" disabled={busy || !gateway || (!e164 && gateway !== 'wallet') || !!mismatch} onClick={start}>
        {busy ? 'Sending…' : `Pay ${le(target.amountMinor)}`}
      </button>
    </div>
  );
}
