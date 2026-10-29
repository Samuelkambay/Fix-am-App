import { useEffect, useState } from 'react';
import { commissionApi, providersApi, type CommissionPlan, type CommissionResult } from '../../api';
import { PaymentFlow } from '../../components/PaymentFlow';
import { Async, Button, Card, Empty, ErrorBox, Field, MoneyInput, PageHeader, StatusPill } from '../../components/ui';
import { date, le, pct } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { RATE_SOURCE_LABELS } from '../../lib/labels';
import { useToast } from '../../lib/toast';
import { useProvider } from './context';

export default function Plans() {
  const { me, reload } = useProvider();
  const toast = useToast();
  const plans = useApi(() => commissionApi.plans(), []);
  const subs = useApi(() => providersApi.subscriptions(), []);
  const [buying, setBuying] = useState<CommissionPlan | null>(null);
  const sub = me.active_subscription;

  return (
    <>
      <PageHeader title="Plans" subtitle="Pay per job, or pay a monthly fee for a lower (or zero) commission. Subscriptions are paid by mobile money and the fee includes GST." />
      <div className="stack">
        <Async state={plans} empty={<Card><Empty title="No plans available" /></Card>}>
          {(rows) => (
            <div className="grid grid-3">
              {rows.map((p) => {
                const current = p.id === me.commission_plan_id;
                const subscribable = p.model !== 'commission';
                const subscribedHere = current && !!sub && sub.plan_id === p.id;
                return (
                  <div key={p.id} className={`card plan-card ${current ? 'current' : ''}`}>
                    <div className="row-between">
                      <h2>{p.name}</h2>
                      {current && <span className="pill pill-good plain">Your plan</span>}
                    </div>
                    <div>
                      <span className="plan-price">{subscribable ? le(p.subscription_fee_minor) : pct(p.default_rate_bps)}</span>
                      <span className="muted"> {subscribable ? `/ ${p.subscription_period_days} days` : 'per job'}</span>
                    </div>
                    <ul className="list-plain small">
                      {subscribable ? (
                        <>
                          <li>
                            <strong>{pct(p.subscription_rate_bps)}</strong> commission while subscribed
                          </li>
                          <li>{pct(p.default_rate_bps)} if the subscription runs out</li>
                        </>
                      ) : (
                        <>
                          <li>No monthly fee</li>
                          {p.tiers.length > 0 && <li>Lower rate with volume: {p.tiers.filter((t) => t.min_gmv_minor > 0).map((t) => `${pct(t.rate_bps)} above ${le(t.min_gmv_minor)}/month`).join(', ')}</li>}
                        </>
                      )}
                      {p.surcharge_rate_bps != null && <li>Only {pct(p.surcharge_rate_bps)} on peak-hour surcharges</li>}
                      {p.min_commission_minor > 0 && <li>Minimum {le(p.min_commission_minor)} per job</li>}
                      {p.category_rates && p.category_rates.length > 0 && <li>Special rates: {p.category_rates.map((r) => `${r.category_name} ${pct(r.rate_bps)}`).join(', ')}</li>}
                    </ul>
                    <div style={{ marginTop: 'auto' }}>
                      {subscribable ? (
                        <Button variant={current ? 'primary' : 'secondary'} onClick={() => setBuying(p)}>
                          {subscribedHere ? `Renew (active until ${date(sub!.ends_at)})` : current ? 'Pay subscription' : `Switch – pay ${le(p.subscription_fee_minor)}`}
                        </Button>
                      ) : current ? (
                        <span className="small muted">You pay only when you complete a job.</span>
                      ) : (
                        <span className="small muted">To move back to pay-per-job, call FixAm support.</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Async>

        <div className="grid grid-2">
          <EarnPreview />
          <Card title="Subscription history" flush>
            <Async state={subs} empty={<Empty title="No subscriptions yet" />}>
              {(rows) => (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Period</th>
                        <th className="right">Fee</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => (
                        <tr key={s.id}>
                          <td>{s.plan_name}</td>
                          <td className="small">{s.starts_at ? `${date(s.starts_at)} – ${date(s.ends_at)}` : <span className="muted">Not started</span>}</td>
                          <td className="right num">{le(s.subscription_fee_minor)}</td>
                          <td>
                            <StatusPill status={s.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Async>
          </Card>
        </div>
      </div>

      {buying && (
        <PaymentFlow
          title={`${buying.name} subscription`}
          description={
            <>
              {le(buying.subscription_fee_minor)} for {buying.subscription_period_days} days. While it is active you pay {pct(buying.subscription_rate_bps)} commission.
              {sub && sub.plan_id === buying.id && <> The new period starts when your current one ends ({date(sub.ends_at)}).</>}
            </>
          }
          amountMinor={buying.subscription_fee_minor}
          defaultMsisdn={me.payout_msisdn}
          buildBody={(gateway, msisdn) => ({ purpose: 'subscription', planId: buying.id, gateway, msisdn })}
          onFinished={(p) => {
            if (p.status === 'succeeded') toast.success(`${buying.name} is active`);
            reload();
            subs.reload();
          }}
          onClose={() => {
            setBuying(null);
            reload();
            subs.reload();
          }}
        />
      )}
    </>
  );
}

function EarnPreview() {
  const { me } = useProvider();
  const [serviceId, setServiceId] = useState(me.services[0]?.id ?? '');
  const svc = me.services.find((s) => s.id === serviceId);
  const [price, setPrice] = useState<number | null>(svc ? (svc.price_override_minor ?? svc.base_price_minor) : null);
  const [surcharge, setSurcharge] = useState<number | null>(0);
  const [res, setRes] = useState<CommissionResult | null>(null);
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (svc) setPrice(svc.price_override_minor ?? svc.base_price_minor);
  }, [svc]);

  const run = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      setRes(await providersApi.commissionPreview(serviceId, price ?? 0, surcharge ?? 0));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  if (!me.services.length)
    return (
      <Card title="What will I earn?">
        <Empty title="Add a service first" />
      </Card>
    );

  return (
    <Card title="What will I earn?" subtitle="Your take-home from one job under your current plan, after commission and GST.">
      <div className="form-grid">
        <Field label="Service" className="full">
          <select className="select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {me.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Job price">
          <MoneyInput value={price} onChange={setPrice} />
        </Field>
        <Field label="Peak surcharge" hint="Extra for evening, night or holiday jobs">
          <MoneyInput value={surcharge} onChange={setSurcharge} />
        </Field>
        <div className="full">
          <Button variant="primary" busy={busy} disabled={!serviceId || price == null} onClick={run}>
            Show my earning
          </Button>
        </div>
      </div>
      {err !== undefined && <ErrorBox error={err} />}
      {res && (
        <table className="lines" style={{ marginTop: 14 }}>
          <tbody>
            <tr>
              <td>Customer pays</td>
              <td>{le(res.totalMinor)}</td>
            </tr>
            <tr>
              <td>
                FixAm commission ({pct(res.rateBps)}, {RATE_SOURCE_LABELS[res.rateSource]?.toLowerCase()})
              </td>
              <td>−{le(res.commissionMinor)}</td>
            </tr>
            <tr>
              <td>GST on commission</td>
              <td>−{le(res.gstMinor)}</td>
            </tr>
            <tr className="total">
              <td>You keep</td>
              <td className="good">{le(res.providerEarningMinor)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}
