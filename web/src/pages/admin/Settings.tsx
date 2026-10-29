import { useEffect, useState } from 'react';
import { adminApi, badgesApi, type Settings as SettingsT } from '../../api';
import { Button, Card, Check, ErrorBox, Field, MoneyInput, PageHeader, PercentInput, Spinner, Switch } from '../../components/ui';
import { useApi } from '../../lib/hooks';
import { useToast } from '../../lib/toast';

type Prefixes = SettingsT['phone_prefixes'];
const NETWORKS: { key: keyof Prefixes; label: string }[] = [
  { key: 'orange', label: 'Orange' },
  { key: 'africell', label: 'Africell' },
  { key: 'qcell', label: 'Qcell' },
];

export default function Settings() {
  const toast = useToast();
  const state = useApi(() => adminApi.settings(), []);
  const defs = useApi(() => badgesApi.definitions(), []);
  const [f, setF] = useState<SettingsT | null>(null);
  const [prefixText, setPrefixText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.data) {
      setF(state.data);
      setPrefixText(Object.fromEntries(NETWORKS.map((n) => [n.key, (state.data!.phone_prefixes[n.key] ?? []).join(', ')])));
    }
  }, [state.data]);

  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (!f || !state.data) return <Spinner />;
  const orig = state.data;
  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => setF((x) => (x ? { ...x, [k]: v } : x));

  const parsedPrefixes = Object.fromEntries(
    NETWORKS.map((n) => [
      n.key,
      (prefixText[n.key] ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ]),
  ) as Prefixes;
  const badPrefix = Object.values(parsedPrefixes).flat().some((p) => !/^\d{2}$/.test(p));
  const draft: SettingsT = { ...f, phone_prefixes: parsedPrefixes };
  const changed = (Object.keys(draft) as (keyof SettingsT)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(orig[k]));
  const invalid = !(draft['pricing.max_multiplier'] >= 1) || !(draft['pricing.demand_window_hours'] > 0) || badPrefix;

  const save = async () => {
    setBusy(true);
    try {
      const patch = Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<SettingsT>;
      state.setData(await adminApi.saveSettings(patch));
      toast.success(`Saved ${changed.length} setting(s)`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const verificationBadges = (defs.data ?? []).filter((d) => d.kind === 'verification');

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Platform-wide rules. Changes apply to new quotes, settlements and payouts immediately and are written to the audit log."
        actions={
          <>
            {changed.length > 0 && <span className="small muted">{changed.length} unsaved change(s)</span>}
            <Button disabled={!changed.length} onClick={() => state.data && setF(state.data)}>
              Discard
            </Button>
            <Button variant="primary" busy={busy} disabled={!changed.length || invalid} onClick={save}>
              Save changes
            </Button>
          </>
        }
      />
      <div className="grid grid-2">
        <Card title="Peak pricing guardrails">
          <div className="form-grid">
            <Field label="Max combined multiplier" hint="pricing.max_multiplier">
              <div className="input-affix">
                <span className="affix">×</span>
                <input className="input num" type="number" step="0.05" min={1} value={f['pricing.max_multiplier']} onChange={(e) => set('pricing.max_multiplier', Number(e.target.value))} />
              </div>
            </Field>
            <Field label="Max surcharge per job" hint="pricing.max_surcharge_minor">
              <MoneyInput value={f['pricing.max_surcharge_minor']} onChange={(v) => set('pricing.max_surcharge_minor', v ?? 0)} allowEmpty={false} />
            </Field>
            <Field label="Demand window" hint="pricing.demand_window_hours – hours either side of the job time">
              <div className="input-affix">
                <input className="input num" type="number" min={1} step={1} value={f['pricing.demand_window_hours']} onChange={(e) => set('pricing.demand_window_hours', Number(e.target.value))} />
                <span className="affix">hours</span>
              </div>
            </Field>
          </div>
        </Card>
        <Card title="Commission & tax">
          <div className="form-grid">
            <Field label="GST rate" hint="commission.gst_rate_bps – Sierra Leone GST is 15%">
              <PercentInput value={f['commission.gst_rate_bps']} onChange={(v) => set('commission.gst_rate_bps', v ?? 0)} />
            </Field>
            <Field label="GST borne by" hint="commission.gst_borne_by">
              <select className="select" value={f['commission.gst_borne_by']} onChange={(e) => set('commission.gst_borne_by', e.target.value as 'provider' | 'platform')}>
                <option value="provider">Provider (added on top of commission)</option>
                <option value="platform">Platform (inside the commission)</option>
              </select>
            </Field>
          </div>
        </Card>
        <Card title="Cash jobs & payouts">
          <div className="form-grid">
            <Field label="Cash commission limit" hint="cash.max_commission_due_minor – above this a provider cannot accept jobs until they pay" className="full">
              <MoneyInput value={f['cash.max_commission_due_minor']} onChange={(v) => set('cash.max_commission_due_minor', v ?? 0)} allowEmpty={false} />
            </Field>
            <Field label="Minimum withdrawal" hint="payout.min_minor">
              <MoneyInput value={f['payout.min_minor']} onChange={(v) => set('payout.min_minor', v ?? 0)} allowEmpty={false} />
            </Field>
            <Field label="Withdrawal fee" hint="payout.fee_minor">
              <MoneyInput value={f['payout.fee_minor']} onChange={(v) => set('payout.fee_minor', v ?? 0)} allowEmpty={false} />
            </Field>
          </div>
        </Card>
        <Card title="Trust & verification">
          <Field label="Badges required to accept jobs" hint="badges.required_to_accept_jobs">
            <div className="stack-sm">
              {verificationBadges.map((d) => (
                <Check
                  key={d.code}
                  checked={f['badges.required_to_accept_jobs'].includes(d.code)}
                  onChange={(on) =>
                    set('badges.required_to_accept_jobs', on ? [...f['badges.required_to_accept_jobs'], d.code] : f['badges.required_to_accept_jobs'].filter((c) => c !== d.code))
                  }
                  label={`${d.name} (${d.code})`}
                />
              ))}
            </div>
          </Field>
        </Card>
        <Card title="Mobile money" className="full">
          <div className="stack-sm">
            <Switch
              checked={f['payment.strict_operator_match']}
              onChange={(v) => set('payment.strict_operator_match', v)}
              label="Reject a wallet that does not match the number's network (e.g. Orange Money on an Africell number)"
            />
            <p className="small muted">payment.strict_operator_match · phone_prefixes: first two digits of the 8-digit national number. Confirm against the current NatCA numbering plan.</p>
            <div className="form-grid">
              {NETWORKS.map((n) => (
                <Field key={n.key} label={`${n.label} prefixes`} error={(prefixText[n.key] ?? '').split(/[\s,]+/).filter(Boolean).some((p) => !/^\d{2}$/.test(p)) ? 'Two digits each, comma separated' : undefined}>
                  <input className="input mono" value={prefixText[n.key] ?? ''} onChange={(e) => setPrefixText((x) => ({ ...x, [n.key]: e.target.value }))} />
                </Field>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
