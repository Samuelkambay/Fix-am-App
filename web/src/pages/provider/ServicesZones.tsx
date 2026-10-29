import { useEffect, useMemo, useState } from 'react';
import { catalogApi, providersApi, zonesApi } from '../../api';
import { Async, Button, Card, Check, MoneyInput, PageHeader } from '../../components/ui';
import { le } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { useProvider } from './context';

export default function ServicesZones() {
  return (
    <>
      <PageHeader title="Services & zones" subtitle="Choose the jobs you do and where. You only see requests that match both." />
      <div className="stack">
        <ZonesCard />
        <ServicesCard />
      </div>
    </>
  );
}

function ZonesCard() {
  const { me, reload } = useProvider();
  const toast = useToast();
  const zones = useApi(() => zonesApi.list(), []);
  const [sel, setSel] = useState<string[]>(me.zones.map((z) => z.id));
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(me.zones.map((z) => z.id)), [me.zones]);

  const dirty = [...sel].sort().join() !== me.zones.map((z) => z.id).sort().join();
  const byCity = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const z of zones.data ?? []) m.set(z.city, [...(m.get(z.city) ?? []), z]);
    return [...m.entries()];
  }, [zones.data]);

  const save = async () => {
    setBusy(true);
    try {
      await providersApi.setZones(sel);
      await reload();
      toast.success('Zones saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Zones"
      subtitle={`${sel.length} selected`}
      actions={
        <Button variant="primary" size="sm" busy={busy} disabled={!dirty || sel.length === 0} onClick={save}>
          Save zones
        </Button>
      }
    >
      <Async state={zones}>
        {() => (
          <div className="stack-sm">
            {byCity.map(([city, zs]) => (
              <div key={city}>
                <div className="small strong text-2" style={{ marginBottom: 4 }}>
                  {city}
                </div>
                <div className="chips">
                  {zs.map((z) => (
                    <button
                      type="button"
                      key={z.id}
                      className={`chip ${sel.includes(z.id) ? 'on' : ''}`}
                      aria-pressed={sel.includes(z.id)}
                      onClick={() => setSel((s) => (s.includes(z.id) ? s.filter((x) => x !== z.id) : [...s, z.id]))}
                    >
                      {z.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {sel.length === 0 && <span className="small bad">Pick at least one zone.</span>}
          </div>
        )}
      </Async>
    </Card>
  );
}

function ServicesCard() {
  const { me, reload } = useProvider();
  const toast = useToast();
  const services = useApi(() => catalogApi.services(), []);
  const initial = useMemo(() => Object.fromEntries(me.services.map((s) => [s.id, s.price_override_minor])) as Record<string, number | null>, [me.services]);
  const [sel, setSel] = useState<Record<string, number | null>>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(initial), [initial]);

  const dirty = JSON.stringify(Object.entries(sel).sort()) !== JSON.stringify(Object.entries(initial).sort());
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof services.data>>();
    for (const s of services.data ?? []) m.set(s.category_name, [...(m.get(s.category_name) ?? []), s]);
    return [...m.entries()];
  }, [services.data]);

  const save = async () => {
    setBusy(true);
    try {
      await providersApi.setServices(Object.entries(sel).map(([serviceId, priceOverrideMinor]) => ({ serviceId, priceOverrideMinor })));
      await reload();
      toast.success('Services saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const count = Object.keys(sel).length;
  return (
    <Card
      title="Services"
      subtitle={`${count} selected. Leave your price empty to charge the FixAm base price. Peak pricing is added on top.`}
      actions={
        <Button variant="primary" size="sm" busy={busy} disabled={!dirty || count === 0} onClick={save}>
          Save services
        </Button>
      }
    >
      <Async state={services}>
        {() => (
          <div className="stack">
            {groups.map(([cat, items]) => (
              <div key={cat}>
                <h3 style={{ marginBottom: 6 }}>{cat}</h3>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {items.map((s) => {
                        const on = s.id in sel;
                        return (
                          <tr key={s.id}>
                            <td style={{ width: '55%' }}>
                              <Check
                                checked={on}
                                onChange={(v) =>
                                  setSel((x) => {
                                    const n = { ...x };
                                    if (v) n[s.id] = null;
                                    else delete n[s.id];
                                    return n;
                                  })
                                }
                                label={
                                  <span>
                                    {s.name}
                                    <span className="cell-sub" style={{ display: 'block' }}>
                                      Base {le(s.base_price_minor)}
                                      {s.price_unit === 'per_unit' ? ` per ${s.unit_label ?? 'unit'}` : s.price_unit === 'hourly' ? ' per hour' : ''}
                                    </span>
                                  </span>
                                }
                              />
                            </td>
                            <td style={{ minWidth: 170 }}>
                              {on && (
                                <MoneyInput
                                  value={sel[s.id]}
                                  onChange={(v) => setSel((x) => ({ ...x, [s.id]: v }))}
                                  placeholder={`base ${(s.base_price_minor / 100).toLocaleString('en-US')}`}
                                  aria-label={`Your price for ${s.name}`}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Async>
    </Card>
  );
}
