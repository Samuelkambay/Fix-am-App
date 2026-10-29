import { useEffect, useMemo, useState } from 'react';
import { catalogApi, commissionApi, type Category, type CommissionModel, type CommissionPlan, type CommissionPlanInput, type CommissionResult, type Tier } from '../../api';
import { Async, Button, Card, Check, Empty, ErrorBox, Field, Modal, MoneyInput, PageHeader, PercentInput, Segmented } from '../../components/ui';
import { le, pct } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { RATE_SOURCE_LABELS } from '../../lib/labels';
import { useToast } from '../../lib/toast';

const MODELS: { id: CommissionModel; label: string; help: string }[] = [
  { id: 'commission', label: 'Commission', help: 'Pay per job: FixAm takes a percentage of each job.' },
  { id: 'subscription', label: 'Subscription', help: 'A periodic fee; while it is paid, jobs use the subscription rate (often 0%).' },
  { id: 'hybrid', label: 'Hybrid', help: 'A smaller fee plus a reduced commission while subscribed.' },
];

function toInput(p?: CommissionPlan): CommissionPlanInput {
  return {
    code: p?.code ?? '',
    name: p?.name ?? '',
    model: p?.model ?? 'commission',
    defaultRateBps: p?.default_rate_bps ?? 1500,
    subscriptionRateBps: p?.subscription_rate_bps ?? 0,
    surchargeRateBps: p?.surcharge_rate_bps ?? null,
    minCommissionMinor: p?.min_commission_minor ?? 0,
    maxCommissionMinor: p?.max_commission_minor ?? null,
    subscriptionFeeMinor: p?.subscription_fee_minor ?? 0,
    subscriptionPeriodDays: p?.subscription_period_days ?? 30,
    tiers: p?.tiers ? [...p.tiers].sort((a, b) => a.min_gmv_minor - b.min_gmv_minor) : [],
    isDefault: p?.is_default ?? false,
    active: p?.active ?? true,
  };
}

export default function Commission() {
  const plans = useApi(() => commissionApi.allPlans(), []);
  const cats = useApi(() => catalogApi.categories(), []);
  const [editing, setEditing] = useState<CommissionPlan | 'new' | null>(null);
  const [rates, setRates] = useState<CommissionPlan | null>(null);

  return (
    <>
      <PageHeader
        title="Commission plans"
        subtitle="Rate order for a job: negotiated override → subscription rate (while paid) → category rate → volume tier → plan default. GST is charged on the commission."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + New plan
          </Button>
        }
      />
      <div className="stack">
        <Async state={plans} empty={<Card><Empty title="No plans yet" /></Card>}>
          {(rows) => (
            <div className="grid grid-3">
              {rows.map((p) => (
                <Card key={p.id} className={`plan-card ${p.is_default ? 'current' : ''}`}>
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <h2>{p.name}</h2>
                      <div className="mono small muted">{p.code}</div>
                    </div>
                    <div className="row">
                      {p.is_default && <span className="pill pill-good plain">Default</span>}
                      {!p.active && <span className="pill plain">Inactive</span>}
                    </div>
                  </div>
                  <span className="pill pill-info plain" style={{ alignSelf: 'flex-start' }}>
                    {MODELS.find((m) => m.id === p.model)?.label}
                  </span>
                  <dl className="dl small">
                    <dt>Default rate</dt>
                    <dd className="strong">{pct(p.default_rate_bps)}</dd>
                    {p.model !== 'commission' && (
                      <>
                        <dt>Subscribed rate</dt>
                        <dd className="strong">{pct(p.subscription_rate_bps)}</dd>
                        <dt>Fee</dt>
                        <dd>
                          {le(p.subscription_fee_minor)} / {p.subscription_period_days} days
                        </dd>
                      </>
                    )}
                    <dt>Peak surcharge</dt>
                    <dd>{p.surcharge_rate_bps == null ? 'Same as job rate' : pct(p.surcharge_rate_bps)}</dd>
                    <dt>Min / max</dt>
                    <dd>
                      {le(p.min_commission_minor)} / {p.max_commission_minor == null ? 'no cap' : le(p.max_commission_minor)}
                    </dd>
                    <dt>Volume tiers</dt>
                    <dd>{p.tiers.length ? p.tiers.map((t) => `${pct(t.rate_bps)} from ${le(t.min_gmv_minor)}`).join(' · ') : 'None'}</dd>
                    <dt>Category rates</dt>
                    <dd>{p.category_rates?.length ? p.category_rates.map((r) => `${r.category_name} ${pct(r.rate_bps)}`).join(' · ') : 'None'}</dd>
                  </dl>
                  <div className="row" style={{ marginTop: 'auto' }}>
                    <Button size="sm" onClick={() => setEditing(p)}>
                      Edit plan
                    </Button>
                    <Button size="sm" onClick={() => setRates(p)}>
                      Category rates
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Async>
        <Calculator plans={plans.data ?? []} categories={cats.data ?? []} />
      </div>
      {editing && (
        <PlanForm
          plan={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            plans.reload();
          }}
        />
      )}
      {rates && (
        <CategoryRates
          plan={rates}
          categories={cats.data ?? []}
          onClose={() => setRates(null)}
          onSaved={() => {
            setRates(null);
            plans.reload();
          }}
        />
      )}
    </>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan?: CommissionPlan; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<CommissionPlanInput>(() => toInput(plan));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const set = <K extends keyof CommissionPlanInput>(k: K, v: CommissionPlanInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const subs = f.model !== 'commission';

  const problems: string[] = [];
  if (!plan && !/^[a-z0-9_]+$/.test(f.code)) problems.push('Code: lowercase letters, digits and _ only');
  if (f.name.trim().length < 2) problems.push('Name is required');
  if (f.defaultRateBps == null || f.defaultRateBps > 10000) problems.push('Default rate must be 0–100%');
  if (subs && !(f.subscriptionPeriodDays > 0)) problems.push('Subscription period must be at least 1 day');
  if (subs && !(f.subscriptionFeeMinor > 0)) problems.push('Set a subscription fee');
  if (f.maxCommissionMinor != null && f.maxCommissionMinor <= 0) problems.push('Max commission must be above zero (or empty)');
  if (f.tiers.some((t) => t.rate_bps == null || t.rate_bps > 10000)) problems.push('Every tier needs a rate of 0–100%');
  if (new Set(f.tiers.map((t) => t.min_gmv_minor)).size !== f.tiers.length) problems.push('Two tiers have the same GMV threshold');

  const setTier = (i: number, patch: Partial<Tier>) => set('tiers', f.tiers.map((t, j) => (i === j ? { ...t, ...patch } : t)));

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const body: CommissionPlanInput = { ...f, name: f.name.trim(), tiers: [...f.tiers].sort((a, b) => a.min_gmv_minor - b.min_gmv_minor) };
      if (!subs) {
        body.subscriptionFeeMinor = 0;
        body.subscriptionRateBps = 0;
      }
      if (plan) {
        const { code: _code, ...patch } = body;
        await commissionApi.updatePlan(plan.id, patch);
      } else await commissionApi.createPlan(body);
      toast.success(plan ? 'Plan saved' : 'Plan created');
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={plan ? `Edit ${plan.name}` : 'New commission plan'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {problems.length > 0 && <span className="small warn" style={{ marginRight: 'auto', alignSelf: 'center' }}>{problems[0]}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={problems.length > 0} onClick={save}>
            {plan ? 'Save plan' : 'Create plan'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Model" hint={MODELS.find((m) => m.id === f.model)?.help}>
          <Segmented options={MODELS.map((m) => ({ id: m.id, label: m.label }))} value={f.model} onChange={(v) => set('model', v)} />
        </Field>
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Growth (monthly + 8%)" />
          </Field>
          <Field label="Code" hint={plan ? 'Codes cannot be changed' : 'e.g. growth_monthly'}>
            <input className="input mono" value={f.code} disabled={!!plan} onChange={(e) => set('code', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          </Field>
          <Field label="Default commission rate" hint="Used when no other rate applies">
            <PercentInput value={f.defaultRateBps} onChange={(v) => set('defaultRateBps', v ?? 0)} />
          </Field>
          <Field label="Peak surcharge rate" hint="Commission on the peak surcharge. Empty = same as the job rate.">
            <PercentInput value={f.surchargeRateBps} onChange={(v) => set('surchargeRateBps', v)} placeholder="same as job" />
          </Field>
          <Field label="Minimum commission per job">
            <MoneyInput value={f.minCommissionMinor} onChange={(v) => set('minCommissionMinor', v ?? 0)} allowEmpty={false} />
          </Field>
          <Field label="Maximum commission per job" hint="Empty = no cap">
            <MoneyInput value={f.maxCommissionMinor} onChange={(v) => set('maxCommissionMinor', v)} placeholder="no cap" />
          </Field>
          {subs && (
            <>
              <Field label="Subscription fee" hint="GST-inclusive">
                <MoneyInput value={f.subscriptionFeeMinor} onChange={(v) => set('subscriptionFeeMinor', v ?? 0)} allowEmpty={false} />
              </Field>
              <Field label="Period (days)">
                <input className="input num" type="number" min={1} value={f.subscriptionPeriodDays} onChange={(e) => set('subscriptionPeriodDays', Math.round(Number(e.target.value)))} />
              </Field>
              <Field label="Commission while subscribed">
                <PercentInput value={f.subscriptionRateBps} onChange={(v) => set('subscriptionRateBps', v ?? 0)} />
              </Field>
            </>
          )}
        </div>

        <div>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="field-label">Volume tiers</span>
            <Button size="sm" onClick={() => set('tiers', [...f.tiers, { min_gmv_minor: (f.tiers.at(-1)?.min_gmv_minor ?? 0) + 2000000, rate_bps: 1200 }])}>
              + Add tier
            </Button>
          </div>
          <p className="small muted">Rate by the provider’s completed GMV over the last 30 days. The highest threshold they reach applies.</p>
          {f.tiers.length === 0 ? (
            <div className="small muted">No tiers – the default rate applies.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>From 30-day GMV</th>
                    <th>Rate</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {f.tiers.map((t, i) => (
                    <tr key={i}>
                      <td style={{ minWidth: 180 }}>
                        <MoneyInput value={t.min_gmv_minor} onChange={(v) => setTier(i, { min_gmv_minor: v ?? 0 })} allowEmpty={false} />
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <PercentInput value={t.rate_bps} onChange={(v) => setTier(i, { rate_bps: v ?? 0 })} />
                      </td>
                      <td className="right">
                        <Button size="sm" variant="ghost" aria-label="Remove tier" onClick={() => set('tiers', f.tiers.filter((_, j) => j !== i))}>
                          ✕
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 20 }}>
          <Check checked={f.isDefault} onChange={(v) => set('isDefault', v)} label="Default plan for new providers" />
          <Check checked={f.active} onChange={(v) => set('active', v)} label="Active (visible to providers)" />
        </div>
        {err !== undefined && <ErrorBox error={err} />}
      </div>
    </Modal>
  );
}

function CategoryRates({ plan, categories, onClose, onSaved }: { plan: CommissionPlan; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const flat = useMemo(() => categories.flatMap((c) => [c, ...c.children]), [categories]);
  const [rates, setRates] = useState<Record<string, number | null>>(() => Object.fromEntries((plan.category_rates ?? []).map((r) => [r.category_id, r.rate_bps])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await commissionApi.setCategoryRates(
        plan.id,
        Object.entries(rates)
          .filter(([, v]) => v != null)
          .map(([categoryId, rateBps]) => ({ categoryId, rateBps: rateBps! })),
      );
      toast.success('Category rates saved');
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Category rates – ${plan.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Save rates
          </Button>
        </>
      }
    >
      <p className="text-2">A category rate beats volume tiers and the default ({pct(plan.default_rate_bps)}). Leave empty to use those.</p>
      <div className="stack-sm">
        {flat.map((c) => (
          <div key={c.id} className="row-between">
            <span>
              {c.parent_id ? '— ' : ''}
              {c.name}
            </span>
            <div style={{ width: 130 }}>
              <PercentInput value={rates[c.id] ?? null} onChange={(v) => setRates((r) => ({ ...r, [c.id]: v }))} placeholder="default" />
            </div>
          </div>
        ))}
      </div>
      {err !== undefined && <ErrorBox error={err} />}
    </Modal>
  );
}

function Calculator({ plans, categories }: { plans: CommissionPlan[]; categories: Category[] }) {
  const [planId, setPlanId] = useState('');
  const [subtotal, setSubtotal] = useState<number | null>(50000);
  const [surcharge, setSurcharge] = useState<number | null>(0);
  const [discount, setDiscount] = useState<number | null>(0);
  const [categoryId, setCategoryId] = useState('');
  const [override, setOverride] = useState<number | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [gmv, setGmv] = useState<number | null>(0);
  const [res, setRes] = useState<CommissionResult | null>(null);
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const flat = useMemo(() => categories.flatMap((c) => [c, ...c.children]), [categories]);
  const plan = plans.find((p) => p.id === planId);

  useEffect(() => {
    if (!planId && plans.length) setPlanId(plans.find((p) => p.is_default)?.id ?? plans[0].id);
  }, [plans, planId]);

  const run = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      setRes(
        await commissionApi.simulate({
          planId,
          subtotalMinor: subtotal ?? 0,
          surchargeMinor: surcharge ?? 0,
          discountMinor: discount ?? 0,
          categoryId: categoryId || undefined,
          providerOverrideBps: override,
          hasActiveSubscription: subscribed,
          trailingGmvMinor: gmv ?? 0,
        }),
      );
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Commission calculator" subtitle="What a plan does to one job. Uses the live GST settings.">
      <div className="grid grid-2">
        <div className="form-grid">
          <Field label="Plan">
            <select className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Any (no category rate)</option>
              {flat.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Job price (before peak)">
            <MoneyInput value={subtotal} onChange={setSubtotal} />
          </Field>
          <Field label="Peak surcharge">
            <MoneyInput value={surcharge} onChange={setSurcharge} />
          </Field>
          <Field label="Discount">
            <MoneyInput value={discount} onChange={setDiscount} />
          </Field>
          <Field label="Provider's 30-day GMV" hint="For volume tiers">
            <MoneyInput value={gmv} onChange={setGmv} />
          </Field>
          <Field label="Negotiated override" hint="Empty = none">
            <PercentInput value={override} onChange={setOverride} placeholder="none" />
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <Check checked={subscribed} onChange={setSubscribed} label="Subscription paid up" disabled={plan?.model === 'commission'} />
          </div>
          <div className="full">
            <Button variant="primary" busy={busy} disabled={!planId} onClick={run}>
              Calculate
            </Button>
          </div>
        </div>
        <div>
          {err !== undefined && <ErrorBox error={err} />}
          {!res && err === undefined && <Empty title="Enter a job and press Calculate" />}
          {res && (
            <div className="stack-sm">
              <div className="kpis">
                <div className="kpi">
                  <span className="kpi-label">Provider earns</span>
                  <span className="kpi-value good">{le(res.providerEarningMinor)}</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Platform revenue</span>
                  <span className="kpi-value">{le(res.platformRevenueMinor)}</span>
                </div>
              </div>
              <table className="lines">
                <tbody>
                  <tr>
                    <td>Job total</td>
                    <td>{le(res.totalMinor)}</td>
                  </tr>
                  <tr>
                    <td>
                      Commission · {pct(res.rateBps)} ({RATE_SOURCE_LABELS[res.rateSource]})
                      {res.surchargeRateBps !== res.rateBps && <span className="cell-sub"> · {pct(res.surchargeRateBps)} on surcharge</span>}
                    </td>
                    <td>{le(res.commissionMinor)}</td>
                  </tr>
                  <tr>
                    <td>GST on commission</td>
                    <td>{le(res.gstMinor)}</td>
                  </tr>
                  <tr className="total">
                    <td>Provider keeps</td>
                    <td>{le(res.providerEarningMinor)}</td>
                  </tr>
                </tbody>
              </table>
              {res.adjustments.length > 0 && <div className="banner banner-info">Adjusted: {res.adjustments.map((a) => a.replace(/_/g, ' ')).join(', ')}</div>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
