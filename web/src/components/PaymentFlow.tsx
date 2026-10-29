import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, idempotencyKey, paymentsApi, type CreatePaymentBody, type Gateway, type Payment, type PaymentMethods } from '../api';
import { useDebounced } from '../lib/hooks';
import { le, normalizeLocalPhone, phone as fmtPhone } from '../lib/format';
import { GATEWAYS, methodName } from '../lib/labels';
import { Button, ErrorBox, Field, Modal, PhoneInput, StatusPill } from './ui';

const FINAL = ['succeeded', 'failed', 'expired', 'refunded'];
const OPERATOR_NAMES: Record<string, string> = { orange: 'Orange', africell: 'Africell', qcell: 'Qcell' };

/**
 * Mobile money checkout: pick a wallet and number, POST /payments with an Idempotency-Key,
 * then poll GET /payments/:id while the payer approves on their phone.
 */
export function PaymentFlow({
  title,
  description,
  amountMinor,
  defaultMsisdn,
  buildBody,
  onFinished,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  amountMinor?: number;
  defaultMsisdn?: string | null;
  buildBody: (gateway: Gateway, msisdn: string) => CreatePaymentBody;
  onFinished?: (p: Payment) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [msisdn, setMsisdn] = useState(defaultMsisdn ? fmtPhone(defaultMsisdn) : '');
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [picked, setPicked] = useState(false);
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>();
  const keyRef = useRef<string | null>(null);
  const finishedRef = useRef(false);

  const valid = normalizeLocalPhone(msisdn);
  const debounced = useDebounced(valid, 250);

  // Detect the network from the number and suggest the matching wallet.
  useEffect(() => {
    let cancelled = false;
    paymentsApi
      .methods(debounced ?? undefined)
      .then((m) => {
        if (cancelled) return;
        setMethods(m);
        if (!picked && m.suggested && GATEWAYS.some((g) => g.code === m.suggested)) setGateway(m.suggested as Gateway);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [debounced, picked]);

  // Poll while the payer approves.
  useEffect(() => {
    if (!payment || FINAL.includes(payment.status)) return;
    const t = setInterval(async () => {
      try {
        setPayment(await paymentsApi.get(payment.id));
      } catch {
        /* keep polling through flaky connections */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [payment]);

  useEffect(() => {
    if (payment && FINAL.includes(payment.status) && !finishedRef.current) {
      finishedRef.current = true;
      onFinished?.(payment);
    }
  }, [payment, onFinished]);

  const available = new Set((methods?.methods ?? []).filter((m) => m.type === 'mobile_money').map((m) => m.code));
  const sandbox = (methods?.methods ?? []).some((m) => m.sandbox);

  const start = async () => {
    if (!gateway || !valid) return;
    setBusy('start');
    setErr(undefined);
    // Reuse the key only when retrying after a network failure, so a retry never charges twice.
    if (!keyRef.current) keyRef.current = idempotencyKey('web');
    try {
      const p = await paymentsApi.create(buildBody(gateway, valid), keyRef.current);
      finishedRef.current = false;
      setPayment(p);
      keyRef.current = null;
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'network_error')) keyRef.current = null;
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const simulate = async (outcome: 'succeeded' | 'failed') => {
    if (!payment) return;
    setBusy(outcome);
    setErr(undefined);
    try {
      const r = await paymentsApi.simulate(payment.id, outcome);
      setPayment(r.payment);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const mismatch = err instanceof ApiError && err.code === 'wallet_network_mismatch' ? (err.details as { suggestedGateway?: Gateway } | undefined)?.suggestedGateway : undefined;
  const final = payment && FINAL.includes(payment.status);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        !payment ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={busy === 'start'} disabled={!gateway || !valid} onClick={start}>
              {amountMinor ? `Pay ${le(amountMinor)}` : 'Pay'}
            </Button>
          </>
        ) : final ? (
          <>
            {payment.status !== 'succeeded' && (
              <Button
                onClick={() => {
                  setPayment(null);
                  setErr(undefined);
                }}
              >
                Try again
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close (payment continues)</Button>
        )
      }
    >
      {!payment ? (
        <div className="stack-sm">
          {description && <div className="text-2">{description}</div>}
          {children}
          <Field
            label="Mobile money number"
            hint={
              methods?.operator && methods.operator !== 'unknown'
                ? `${OPERATOR_NAMES[methods.operator] ?? methods.operator} number – ${methodName(methods.suggested)} suggested`
                : 'The number that will approve the payment'
            }
            error={msisdn && !valid ? 'Enter a Sierra Leone number, e.g. 076 123 456' : undefined}
          >
            <PhoneInput value={msisdn} onChange={setMsisdn} />
          </Field>
          <div className="field">
            <span className="field-label">Wallet</span>
            <div className="grid grid-2" style={{ gap: 8 }}>
              {GATEWAYS.map((g) => {
                const disabled = methods ? !available.has(g.code) : false;
                return (
                  <label key={g.code} className={`card ${gateway === g.code ? 'plan-card current' : ''}`} style={{ padding: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
                    <span className="row">
                      <input
                        type="radio"
                        name="gateway"
                        checked={gateway === g.code}
                        disabled={disabled}
                        onChange={() => {
                          setGateway(g.code);
                          setPicked(true);
                        }}
                      />
                      <span>
                        <span className="strong">{g.name}</span>
                        <span className="cell-sub" style={{ display: 'block' }}>
                          {g.network}
                          {methods?.suggested === g.code ? ' · suggested' : ''}
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          {err !== undefined && <ErrorBox error={err} />}
          {mismatch && (
            <Button
              size="sm"
              onClick={() => {
                setGateway(mismatch);
                setPicked(true);
                setErr(undefined);
              }}
            >
              Switch to {methodName(mismatch)}
            </Button>
          )}
        </div>
      ) : (
        <div className="stack-sm">
          <div className="row-between">
            <span className="strong">
              {le(payment.amount_minor)} via {methodName(payment.gateway)}
            </span>
            <StatusPill status={payment.status} />
          </div>
          {payment.status === 'pending' || payment.status === 'initiated' ? (
            <div className="banner banner-info" style={{ display: 'block' }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="spinner" aria-hidden />
                <strong>Waiting for approval on {fmtPhone(payment.msisdn)}</strong>
              </div>
              <p style={{ margin: 0 }}>{payment.customer_action?.message ?? 'Approve the payment on your phone.'}</p>
              {payment.customer_action?.ussdCode && (
                <p style={{ margin: '6px 0 0' }}>
                  Dial <span className="code-display">{payment.customer_action.ussdCode}</span>
                </p>
              )}
              {payment.customer_action?.paymentCode && (
                <p style={{ margin: '6px 0 0' }}>
                  Payment code <span className="code-display">{payment.customer_action.paymentCode}</span>
                </p>
              )}
              {payment.customer_action?.redirectUrl && (
                <p style={{ margin: '6px 0 0' }}>
                  <a href={payment.customer_action.redirectUrl} target="_blank" rel="noreferrer">
                    Open the payment page
                  </a>
                </p>
              )}
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                Checking every few seconds. You can close this window – the payment will still go through.
              </p>
            </div>
          ) : payment.status === 'succeeded' ? (
            <div className="banner banner-good">
              <strong>✓ Payment received. Tenki!</strong>
            </div>
          ) : (
            <div className="banner banner-bad" style={{ display: 'block' }}>
              <strong>Payment {payment.status}</strong>
              {payment.failure_reason && <p style={{ margin: '4px 0 0' }}>Reason: {payment.failure_reason.replace(/_/g, ' ')}</p>}
            </div>
          )}
          {sandbox && !final && (
            <div className="row">
              <span className="small muted">Sandbox:</span>
              <Button size="sm" variant="primary" busy={busy === 'succeeded'} onClick={() => simulate('succeeded')}>
                Simulate approval
              </Button>
              <Button size="sm" variant="danger" busy={busy === 'failed'} onClick={() => simulate('failed')}>
                Simulate decline
              </Button>
            </div>
          )}
          {err !== undefined && <ErrorBox error={err} />}
        </div>
      )}
    </Modal>
  );
}
