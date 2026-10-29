import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { catalogApi, providersApi, zonesApi, type Gateway } from '../api';
import { Button, Card, ErrorBox, Field, PhoneInput, Segmented, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { normalizeLocalPhone, phone as fmtPhone } from '../lib/format';
import { useApi } from '../lib/hooks';
import { GATEWAYS } from '../lib/labels';

/** A phone number with no provider account logs in as a customer. This turns it into a provider (pending approval). */
export default function BecomeProvider() {
  const { session, refreshUser, signOut } = useAuth();
  const navigate = useNavigate();
  const zones = useApi(() => zonesApi.list(), []);
  const services = useApi(() => catalogApi.services(), []);
  const [businessName, setBusinessName] = useState('');
  const [kind, setKind] = useState<'individual' | 'company'>('individual');
  const [bio, setBio] = useState('');
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [gateway, setGateway] = useState<Gateway>('orange_money');
  const [msisdn, setMsisdn] = useState(fmtPhone(session?.user.phone));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();

  const byCat = useMemo(() => {
    const m = new Map<string, { name: string; items: { id: string; name: string }[] }>();
    for (const s of services.data ?? []) {
      const g = m.get(s.category_id) ?? { name: s.category_name, items: [] };
      g.items.push({ id: s.id, name: s.name });
      m.set(s.category_id, g);
    }
    return [...m.values()];
  }, [services.data]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const ok = businessName.trim().length >= 2 && zoneIds.length > 0 && serviceIds.length > 0 && normalizeLocalPhone(msisdn);

  const submit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await providersApi.register({
        businessName: businessName.trim(),
        kind,
        bio: bio.trim() || undefined,
        zoneIds,
        services: serviceIds.map((serviceId) => ({ serviceId })),
        payoutGateway: gateway,
        payoutMsisdn: normalizeLocalPhone(msisdn)!,
      });
      await refreshUser();
      navigate('/provider/overview', { replace: true });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content" style={{ margin: '0 auto', maxWidth: 820 }}>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">F</span>
          <span>FixAm Salone</span>
        </div>
        <Button size="sm" onClick={() => signOut().then(() => navigate('/login'))}>
          Log out
        </Button>
      </div>
      <Card title="Register as a FixAm provider" subtitle={`${fmtPhone(session?.user.phone)} has no provider account yet. Tell us about your business – FixAm will review it and SMS you when approved.`}>
        {zones.loading || services.loading ? (
          <Spinner />
        ) : (
          <div className="stack">
            <div className="form-grid">
              <Field label="Business name">
                <input className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Kamara Electrical Works" />
              </Field>
              <Field label="Type">
                <Segmented options={[{ id: 'individual', label: 'Individual' }, { id: 'company', label: 'Company' }]} value={kind} onChange={setKind} />
              </Field>
              <Field label="About you" className="full">
                <textarea className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Your trade, years of experience, areas you cover" />
              </Field>
              <Field label="Payout wallet">
                <select className="select" value={gateway} onChange={(e) => setGateway(e.target.value as Gateway)}>
                  {GATEWAYS.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.name} ({g.network})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Payout number">
                <PhoneInput value={msisdn} onChange={setMsisdn} />
              </Field>
            </div>
            <Field label="Zones you work in">
              <div className="chips">
                {(zones.data ?? []).map((z) => (
                  <button type="button" key={z.id} className={`chip ${zoneIds.includes(z.id) ? 'on' : ''}`} onClick={() => toggle(zoneIds, setZoneIds, z.id)}>
                    {z.name}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Services you offer">
              <div className="stack-sm">
                {byCat.map((g) => (
                  <div key={g.name}>
                    <div className="small strong text-2" style={{ marginBottom: 4 }}>
                      {g.name}
                    </div>
                    <div className="chips">
                      {g.items.map((s) => (
                        <button type="button" key={s.id} className={`chip ${serviceIds.includes(s.id) ? 'on' : ''}`} onClick={() => toggle(serviceIds, setServiceIds, s.id)}>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Field>
            {err !== undefined && <ErrorBox error={err} />}
            <div className="row">
              <Button variant="primary" busy={busy} disabled={!ok} onClick={submit}>
                Submit for approval
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
