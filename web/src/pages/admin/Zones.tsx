import { useState } from 'react';
import { zonesApi, type Zone, type ZoneInput } from '../../api';
import { Async, Button, Card, Check, Empty, ErrorBox, Field, Modal, PageHeader } from '../../components/ui';
import { useApi } from '../../lib/hooks';
import { useToast } from '../../lib/toast';

export default function Zones() {
  const list = useApi(() => zonesApi.list(), []);
  const [editing, setEditing] = useState<Zone | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Zones"
        subtitle="Service areas, each a circle around a centre point. Providers choose the zones they cover; customers are matched by GPS or by picking an area."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + New zone
          </Button>
        }
      />
      <Card flush>
        <Async state={list} empty={<Empty title="No active zones" />}>
          {(rows) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>District</th>
                    <th>City</th>
                    <th className="right">Centre</th>
                    <th className="right">Radius</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((z) => (
                    <tr key={z.id}>
                      <td className="strong">{z.name}</td>
                      <td>{z.district}</td>
                      <td>{z.city}</td>
                      <td className="right num small">
                        <a href={`https://www.openstreetmap.org/?mlat=${z.center_lat}&mlon=${z.center_lng}#map=13/${z.center_lat}/${z.center_lng}`} target="_blank" rel="noreferrer">
                          {z.center_lat.toFixed(4)}, {z.center_lng.toFixed(4)}
                        </a>
                      </td>
                      <td className="right num">{z.radius_km} km</td>
                      <td className="right">
                        <Button size="sm" onClick={() => setEditing(z)}>
                          Edit
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
      <p className="small muted" style={{ marginTop: 8 }}>
        Deactivated zones are hidden from this list and from booking.
      </p>
      {editing && (
        <ZoneForm
          zone={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function ZoneForm({ zone, onClose, onSaved }: { zone?: Zone; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: zone?.name ?? '',
    district: zone?.district ?? '',
    city: zone?.city ?? '',
    centerLat: String(zone?.center_lat ?? ''),
    centerLng: String(zone?.center_lng ?? ''),
    radiusKm: String(zone?.radius_km ?? '5'),
    active: zone?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const lat = Number(f.centerLat);
  const lng = Number(f.centerLng);
  const r = Number(f.radiusKm);
  const problems: string[] = [];
  if (f.name.trim().length < 2 || f.district.trim().length < 2 || f.city.trim().length < 2) problems.push('Name, district and city are required');
  if (!(f.centerLat !== '' && lat >= 6.8 && lat <= 10.1)) problems.push('Latitude must be inside Sierra Leone (6.8 to 10.1)');
  if (!(f.centerLng !== '' && lng >= -13.4 && lng <= -10.2)) problems.push('Longitude must be inside Sierra Leone (−13.4 to −10.2)');
  if (!(r > 0 && r <= 100)) problems.push('Radius must be 0–100 km');

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const body: ZoneInput = { name: f.name.trim(), district: f.district.trim(), city: f.city.trim(), centerLat: lat, centerLng: lng, radiusKm: r, active: f.active };
      if (zone) await zonesApi.update(zone.id, body);
      else await zonesApi.create(body);
      toast.success(zone ? 'Zone saved' : 'Zone created');
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={zone ? `Edit ${zone.name}` : 'New zone'}
      onClose={onClose}
      footer={
        <>
          {problems.length > 0 && <span className="small warn" style={{ marginRight: 'auto', alignSelf: 'center' }}>{problems[0]}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={problems.length > 0} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" className="full">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Freetown - Wellington" />
        </Field>
        <Field label="District">
          <input className="input" value={f.district} onChange={(e) => set('district', e.target.value)} placeholder="e.g. Western Area Urban" />
        </Field>
        <Field label="City">
          <input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Centre latitude">
          <input className="input num" inputMode="decimal" value={f.centerLat} onChange={(e) => set('centerLat', e.target.value)} placeholder="8.4840" />
        </Field>
        <Field label="Centre longitude">
          <input className="input num" inputMode="decimal" value={f.centerLng} onChange={(e) => set('centerLng', e.target.value)} placeholder="-13.2340" />
        </Field>
        <Field label="Radius (km)">
          <input className="input num" inputMode="decimal" value={f.radiusKm} onChange={(e) => set('radiusKm', e.target.value)} />
        </Field>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <Check checked={f.active} onChange={(v) => set('active', v)} label="Active" />
        </div>
        {err !== undefined && (
          <div className="full">
            <ErrorBox error={err} />
          </div>
        )}
      </div>
    </Modal>
  );
}
