import { useEffect, useMemo, useState } from 'react';
import {
  adminApi, catalogApi, pricingApi, zonesApi, type Category, type PricingRule, type PricingRuleInput, type RuleKind, type Settings, type SimulateResult,
} from '../../api';
import { Async, Button, Card, Check, Empty, ErrorBox, Field, Modal, MoneyInput, PageHeader, Spinner, Switch } from '../../components/ui';
import { date, humanize, le, toLocalInput } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { DAYS } from '../../lib/labels';
import { useToast } from '../../lib/toast';

const KINDS: { id: RuleKind; label: string; help: string }[] = [
  { id: 'time_window', label: 'Time window', help: 'Certain hours and/or days, e.g. evenings or Sundays. Windows may wrap midnight (21:00–06:00).' },
  { id: 'holiday', label: 'Holiday', help: 'A date range such as Christmas or Independence Day (27 April).' },
  { id: 'seasonal', label: 'Seasonal', help: 'A longer date range, e.g. rainy-season roof repairs (June–September).' },
  { id: 'demand', label: 'Demand', help: 'Applies when open requests per available provider in the zone reach the ratio.' },
  { id: 'emergency', label: 'Emergency', help: 'Applies when the customer marks the job as urgent.' },
];

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

function toInput(r?: PricingRule): PricingRuleInput {
  return {
    name: r?.name ?? '',
    label: r?.label ?? '',
    kind: r?.kind ?? 'time_window',
    zoneId: r?.zone_id ?? null,
    categoryId: r?.category_id ?? null,
    daysOfWeek: r?.days_of_week ?? null,
    startTime: hhmm(r?.start_time ?? null),
    endTime: hhmm(r?.end_time ?? null),
    dateFrom: r?.date_from ?? null,
    dateTo: r?.date_to ?? null,
    recurringYearly: r?.recurring_yearly ?? false,
    minDemandRatio: r?.min_demand_ratio ?? null,
    multiplier: r?.multiplier ?? 1.2,
    flatFeeMinor: r?.flat_fee_minor ?? 0,
    stackable: r?.stackable ?? false,
    priority: r?.priority ?? 10,
    active: r?.active ?? true,
  };
}

/** Drops fields that do not apply to the rule's kind, so a stale value never changes matching. */
function clean(f: PricingRuleInput): PricingRuleInput {
  const timeKind = f.kind === 'time_window';
  const dateKind = f.kind === 'holiday' || f.kind === 'seasonal';
  return {
    ...f,
    name: f.name.trim(),
    label: f.label.trim(),
    daysOfWeek: timeKind && f.daysOfWeek?.length ? [...f.daysOfWeek].sort() : null,
    startTime: timeKind ? f.startTime || null : null,
    endTime: timeKind ? f.endTime || null : null,
    dateFrom: dateKind ? f.dateFrom || null : null,
    dateTo: dateKind ? f.dateTo || null : null,
    recurringYearly: dateKind ? f.recurringYearly : false,
    minDemandRatio: f.kind === 'demand' ? f.minDemandRatio : null,
  };
}

export function describeWhen(r: PricingRule): string {
  switch (r.kind) {
    case 'time_window': {
      const days = r.days_of_week?.length ? r.days_of_week.map((d) => DAYS[d]).join(', ') : 'Every day';
      const time = r.start_time && r.end_time ? `${hhmm(r.start_time)}–${hhmm(r.end_time)}` : 'all day';
      return `${days}, ${time}`;
    }
    case 'holiday':
    case 'seasonal': {
      const fmt = (d: string | null) => (d ? (r.recurring_yearly ? date(d).replace(/ \d{4}$/, '') : date(d)) : '…');
      return `${fmt(r.date_from)} – ${fmt(r.date_to)}${r.recurring_yearly ? ' (every year)' : ''}`;
    }
    case 'demand':
      return `Demand ratio ≥ ${r.min_demand_ratio ?? '?'}`;
    case 'emergency':
      return 'Urgent jobs';
  }
}

export default function Pricing() {
  const toast = useToast();
  const rules = useApi(() => pricingApi.rules(), []);
  const zones = useApi(() => zonesApi.list(), []);
  const cats = useApi(() => catalogApi.categories(), []);
  const settings = useApi(() => adminApi.settings(), []);
  const [editing, setEditing] = useState<PricingRule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PricingRule | null>(null);

  const flatCats = useMemo(() => (cats.data ?? []).flatMap((c) => [c, ...c.children]), [cats.data]);
  const zoneName = (id: string | null) => (id ? zones.data?.find((z) => z.id === id)?.name ?? 'Unknown zone' : 'All zones');
  const catName = (id: string | null) => (id ? flatCats.find((c) => c.id === id)?.name ?? 'Unknown category' : 'All categories');

  const toggleActive = async (r: PricingRule) => {
    try {
      const updated = await pricingApi.updateRule(r.id, { active: !r.active });
      rules.setData((xs) => (xs ?? []).map((x) => (x.id === r.id ? updated : x)));
      toast.success(`${r.name} ${updated.active ? 'switched on' : 'switched off'}`);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <PageHeader
        title="Peak pricing"
        subtitle="Rules that raise prices at busy times. The best non-stackable rule applies first, stackable rules multiply on top, then the guardrails cap the result."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + New rule
          </Button>
        }
      />
      <div className="stack">
        <Guardrails state={settings} />
        <Card title="Rules" flush>
          <Async state={rules} empty={<Empty title="No pricing rules">Every job is charged the base price.</Empty>}>
            {(rows) => (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>Kind</th>
                      <th>When</th>
                      <th>Scope</th>
                      <th className="right">Multiplier</th>
                      <th className="right">Flat fee</th>
                      <th>Stacks</th>
                      <th className="right">Priority</th>
                      <th>Active</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} style={{ opacity: r.active ? 1 : 0.6 }}>
                        <td>
                          <span className="strong">{r.name}</span>
                          <div className="cell-sub">Customers see: “{r.label}”</div>
                        </td>
                        <td>{humanize(r.kind)}</td>
                        <td className="small">{describeWhen(r)}</td>
                        <td className="small">
                          {zoneName(r.zone_id)}
                          <div className="cell-sub">{catName(r.category_id)}</div>
                        </td>
                        <td className="right num strong">×{Number(r.multiplier).toFixed(2)}</td>
                        <td className="right num">{r.flat_fee_minor ? le(r.flat_fee_minor) : '–'}</td>
                        <td>{r.stackable ? <span className="pill pill-info plain">Stacks</span> : <span className="muted small">Base</span>}</td>
                        <td className="right num">{r.priority}</td>
                        <td>
                          <Switch checked={r.active} onChange={() => toggleActive(r)} />
                        </td>
                        <td className="right nowrap">
                          <Button size="sm" onClick={() => setEditing(r)}>
                            Edit
                          </Button>{' '}
                          <Button size="sm" variant="danger" onClick={() => setDeleting(r)}>
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Async>
        </Card>
        <Simulator categories={cats.data ?? []} zones={zones.data ?? []} />
      </div>

      {editing && (
        <RuleForm
          rule={editing === 'new' ? undefined : editing}
          zones={zones.data ?? []}
          categories={flatCats}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            rules.reload();
          }}
        />
      )}
      {deleting && (
        <Modal
          title={`Delete “${deleting.name}”?`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Keep it</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await pricingApi.deleteRule(deleting.id);
                    toast.success('Rule deleted');
                    setDeleting(null);
                    rules.reload();
                  } catch (e) {
                    toast.error(e);
                  }
                }}
              >
                Delete rule
              </Button>
            </>
          }
        >
          <p>This cannot be undone. To pause a rule instead, switch it off. Existing quotes and bookings keep the price they were given.</p>
        </Modal>
      )}
    </>
  );
}

function Guardrails({ state }: { state: { data: Settings | undefined; error: unknown; loading: boolean; reload: () => Promise<void>; setData: (s: Settings) => void } }) {
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [maxMult, setMaxMult] = useState('');
  const [maxSur, setMaxSur] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const s = state.data;
  useEffect(() => {
    if (s) {
      setMaxMult(String(s['pricing.max_multiplier']));
      setMaxSur(s['pricing.max_surcharge_minor']);
    }
  }, [s, edit]);

  const save = async () => {
    setBusy(true);
    try {
      const next = await adminApi.saveSettings({ 'pricing.max_multiplier': Number(maxMult), 'pricing.max_surcharge_minor': maxSur ?? 0 });
      state.setData(next);
      setEdit(false);
      toast.success('Guardrails saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Guardrails"
      subtitle="Consumer protection: no combination of rules can charge more than this."
      actions={
        s &&
        (edit ? (
          <>
            <Button size="sm" onClick={() => setEdit(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" busy={busy} onClick={save} disabled={!(Number(maxMult) >= 1)}>
              Save
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => setEdit(true)}>
            Edit
          </Button>
        ))
      }
    >
      {state.error ? (
        <ErrorBox error={state.error} onRetry={state.reload} />
      ) : !s ? (
        <Spinner />
      ) : edit ? (
        <div className="form-grid">
          <Field label="Max combined multiplier" hint="e.g. 1.75 = at most 75% above the base price">
            <div className="input-affix">
              <span className="affix">×</span>
              <input className="input num" inputMode="decimal" value={maxMult} onChange={(e) => setMaxMult(e.target.value.replace(/[^\d.]/g, ''))} />
            </div>
          </Field>
          <Field label="Max surcharge per job">
            <MoneyInput value={maxSur} onChange={setMaxSur} />
          </Field>
        </div>
      ) : (
        <div className="kpis">
          <div>
            <div className="kpi-label">Max multiplier</div>
            <div className="kpi-value">×{s['pricing.max_multiplier']}</div>
          </div>
          <div>
            <div className="kpi-label">Max surcharge per job</div>
            <div className="kpi-value">{le(s['pricing.max_surcharge_minor'])}</div>
          </div>
          <div>
            <div className="kpi-label">Demand window</div>
            <div className="kpi-value">±{s['pricing.demand_window_hours']} h</div>
          </div>
        </div>
      )}
    </Card>
  );
}

function RuleForm({
  rule,
  zones,
  categories,
  onClose,
  onSaved,
}: {
  rule?: PricingRule;
  zones: { id: string; name: string }[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<PricingRuleInput>(() => toInput(rule));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const set = <K extends keyof PricingRuleInput>(k: K, v: PricingRuleInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const kind = KINDS.find((k) => k.id === f.kind)!;

  const problems: string[] = [];
  if (f.name.trim().length < 2) problems.push('Name is required');
  if (f.label.trim().length < 2) problems.push('Customer label is required');
  if (!(f.multiplier >= 1 && f.multiplier <= 5)) problems.push('Multiplier must be between 1 and 5');
  if (f.kind === 'time_window' && !!f.startTime !== !!f.endTime) problems.push('Set both start and end time, or neither');
  if (f.kind === 'time_window' && !f.startTime && !f.daysOfWeek?.length) problems.push('Pick days and/or a time window');
  if ((f.kind === 'holiday' || f.kind === 'seasonal') && (!f.dateFrom || !f.dateTo)) problems.push('Set the date range');
  if (f.kind === 'demand' && !(f.minDemandRatio && f.minDemandRatio > 0)) problems.push('Set the minimum demand ratio');

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const body = clean(f);
      if (rule) await pricingApi.updateRule(rule.id, body);
      else await pricingApi.createRule(body);
      toast.success(rule ? 'Rule saved' : 'Rule created');
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={rule ? `Edit “${rule.name}”` : 'New pricing rule'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {problems.length > 0 && <span className="small warn" style={{ marginRight: 'auto', alignSelf: 'center' }}>{problems[0]}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={problems.length > 0} onClick={save}>
            {rule ? 'Save rule' : 'Create rule'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Kind" hint={kind.help}>
          <div className="chips">
            {KINDS.map((k) => (
              <button type="button" key={k.id} className={`chip ${f.kind === k.id ? 'on' : ''}`} onClick={() => set('kind', k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="form-grid">
          <Field label="Internal name">
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Evening peak Freetown" />
          </Field>
          <Field label="Label customers see">
            <input className="input" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Evening rate" />
          </Field>
        </div>

        {f.kind === 'time_window' && (
          <div className="form-grid">
            <Field label="Days" hint="None selected = every day" className="full">
              <div className="chips">
                {DAYS.map((d, i) => {
                  const on = f.daysOfWeek?.includes(i) ?? false;
                  return (
                    <button
                      type="button"
                      key={d}
                      className={`chip ${on ? 'on' : ''}`}
                      onClick={() => set('daysOfWeek', on ? (f.daysOfWeek ?? []).filter((x) => x !== i) : [...(f.daysOfWeek ?? []), i])}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Start time (Freetown)">
              <input className="input" type="time" value={f.startTime ?? ''} onChange={(e) => set('startTime', e.target.value || null)} />
            </Field>
            <Field label="End time" hint={f.startTime && f.endTime && f.endTime < f.startTime ? 'Wraps past midnight – early hours count for the previous day' : undefined}>
              <input className="input" type="time" value={f.endTime ?? ''} onChange={(e) => set('endTime', e.target.value || null)} />
            </Field>
          </div>
        )}

        {(f.kind === 'holiday' || f.kind === 'seasonal') && (
          <div className="form-grid">
            <Field label="From">
              <input className="input" type="date" value={f.dateFrom ?? ''} onChange={(e) => set('dateFrom', e.target.value || null)} />
            </Field>
            <Field label="To (inclusive)" hint={f.recurringYearly && f.dateFrom && f.dateTo && f.dateTo.slice(5) < f.dateFrom.slice(5) ? 'Wraps the new year' : undefined}>
              <input className="input" type="date" value={f.dateTo ?? ''} onChange={(e) => set('dateTo', e.target.value || null)} />
            </Field>
            <div className="full">
              <Check checked={f.recurringYearly} onChange={(v) => set('recurringYearly', v)} label="Repeat every year (only month and day are compared)" />
            </div>
          </div>
        )}

        {f.kind === 'demand' && (
          <Field label="Minimum demand ratio" hint="Open requests per available provider in the zone, around the job time. 2 = twice as many jobs as fixers.">
            <input
              className="input num"
              style={{ maxWidth: 160 }}
              inputMode="decimal"
              value={f.minDemandRatio ?? ''}
              onChange={(e) => set('minDemandRatio', e.target.value === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')))}
            />
          </Field>
        )}

        <div className="form-grid">
          <Field label="Multiplier" hint={`×${f.multiplier || 1} = ${Math.round(((f.multiplier || 1) - 1) * 100)}% on top of the base price`}>
            <div className="input-affix">
              <span className="affix">×</span>
              <input
                className="input num"
                type="number"
                step="0.05"
                min={1}
                max={5}
                value={f.multiplier}
                onChange={(e) => set('multiplier', Number(e.target.value))}
              />
            </div>
          </Field>
          <Field label="Flat fee" hint="Added once per job, e.g. a call-out fee">
            <MoneyInput value={f.flatFeeMinor} onChange={(v) => set('flatFeeMinor', v ?? 0)} allowEmpty={false} />
          </Field>
          <Field label="Zone">
            <select className="select" value={f.zoneId ?? ''} onChange={(e) => set('zoneId', e.target.value || null)}>
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category" hint="A parent category also covers its sub-categories">
            <select className="select" value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? '— ' : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority" hint="Higher wins among non-stackable rules">
            <input className="input num" type="number" step={1} value={f.priority} onChange={(e) => set('priority', Math.round(Number(e.target.value)))} />
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <Check checked={f.stackable} onChange={(v) => set('stackable', v)} label="Stackable (multiplies on top of the base rule)" />
            <Check checked={f.active} onChange={(v) => set('active', v)} label="Active" />
          </div>
        </div>
        {err !== undefined && <ErrorBox error={err} />}
      </div>
    </Modal>
  );
}

function Simulator({ categories, zones }: { categories: Category[]; zones: { id: string; name: string }[] }) {
  const services = useApi(() => catalogApi.services(), []);
  const [zoneId, setZoneId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [unit, setUnit] = useState<number | null>(25000);
  const [quantity, setQuantity] = useState(1);
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setUTCHours(19, 0, 0, 0);
    return toLocalInput(d);
  });
  const [demand, setDemand] = useState(0);
  const [urgent, setUrgent] = useState(false);
  const [res, setRes] = useState<SimulateResult | null>(null);
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!zoneId && zones.length) setZoneId(zones.find((z) => z.name.startsWith('Freetown'))?.id ?? zones[0].id);
  }, [zones, zoneId]);
  useEffect(() => {
    if (!serviceId && services.data?.length) {
      setServiceId(services.data[0].id);
      setUnit(services.data[0].base_price_minor);
    }
  }, [services.data, serviceId]);

  const svc = services.data?.find((s) => s.id === serviceId);
  const categoryIds = useMemo(() => {
    if (!svc) return [];
    const flat = categories.flatMap((c) => [c, ...c.children]);
    const cat = flat.find((c) => c.id === svc.category_id);
    return [svc.category_id, cat?.parent_id].filter(Boolean) as string[];
  }, [svc, categories]);

  const run = async () => {
    if (!zoneId) return;
    setBusy(true);
    setErr(undefined);
    try {
      setRes(
        await pricingApi.simulate({
          unitPriceMinor: unit ?? 0,
          quantity,
          zoneId,
          categoryIds,
          scheduledAt: new Date(`${when}:00Z`).toISOString(), // Freetown is UTC+0
          isEmergency: urgent,
          demandRatio: demand,
        }),
      );
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Simulator" subtitle="Dry-run the active rules for any job. Nothing is saved and no quote is created.">
      <div className="grid grid-2">
        <div className="form-grid">
          <Field label="Zone">
            <select className="select" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service (sets category and price)">
            <select
              className="select"
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                const s = services.data?.find((x) => x.id === e.target.value);
                if (s) setUnit(s.base_price_minor);
              }}
            >
              {(services.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.category_name} – {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unit price">
            <MoneyInput value={unit} onChange={setUnit} />
          </Field>
          <Field label={`Quantity${svc?.unit_label ? ` (${svc.unit_label}s)` : ''}`}>
            <input className="input num" type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Date & time (Freetown)">
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Demand ratio" hint="Open requests per available provider">
            <input className="input num" type="number" min={0} step={0.5} value={demand} onChange={(e) => setDemand(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <div className="full row-between">
            <Check checked={urgent} onChange={setUrgent} label="Urgent / emergency job" />
            <Button variant="primary" busy={busy} disabled={!zoneId || !when} onClick={run}>
              Simulate price
            </Button>
          </div>
        </div>
        <div>
          {err !== undefined && <ErrorBox error={err} />}
          {!res && err === undefined && <Empty title="Pick a scenario and press Simulate">Try Friday 22:00 for the night call-out, or tick urgent.</Empty>}
          {res && (
            <div className="stack-sm">
              <div className="row-between">
                <span className="kpi-value">{le(res.totalMinor)}</span>
                <span className={`pill ${res.isPeak ? 'pill-warn' : 'pill-good'}`}>{res.isPeak ? `Peak ×${res.multiplier}` : 'Normal price'}</span>
              </div>
              <table className="lines">
                <tbody>
                  {res.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.label}</td>
                      <td>{le(l.amountMinor)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Customer pays</td>
                    <td>{le(res.totalMinor)}</td>
                  </tr>
                </tbody>
              </table>
              {res.cappedBy && (
                <div className="banner banner-info">
                  Capped by the {res.cappedBy === 'max_multiplier' ? 'maximum multiplier' : 'maximum surcharge'} guardrail.
                </div>
              )}
              <h3 style={{ marginTop: 8 }}>Applied rules</h3>
              {res.appliedRules.length === 0 ? (
                <span className="muted">No rule matched.</span>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Rule</th>
                        <th>Role</th>
                        <th className="right">×</th>
                        <th className="right">Flat fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.appliedRules.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.label}
                            <div className="cell-sub">{humanize(r.kind)}</div>
                          </td>
                          <td>{r.stacked ? 'Stacked on top' : 'Base rule'}</td>
                          <td className="right num">{r.multiplier}</td>
                          <td className="right num">{r.flatFeeMinor ? le(r.flatFeeMinor) : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
