import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Service } from '../api/types';
import { Empty, ErrorBox, Spinner } from '../components/ui';
import { le, unitText } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useZone } from '../lib/zone';

export function ServiceList({ services }: { services: Service[] }) {
  return (
    <div className="list">
      {services.map((s) => (
        <Link key={s.id} to={`/service/${s.id}`} className="list-item">
          <div>
            <div className="list-title">{s.name}</div>
            <div className="muted small">
              {s.category_name} · about {Math.round(s.duration_minutes / 60) || 1} h
            </div>
          </div>
          <div className="price">
            <span className="muted small">from</span> {le(s.base_price_minor)}
            <span className="muted small"> {unitText(s.price_unit, s.unit_label)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { zone } = useZone();
  const res = useAsync(() => api<Service[]>('/catalog/services', { query: { q, zoneId: zone?.id } }), [q, zone?.id]);
  return (
    <div className="stack">
      <h1>Results for “{q}”</h1>
      {res.loading && <Spinner />}
      <ErrorBox error={res.error} onRetry={() => res.reload()} />
      {res.data && res.data.length === 0 && (
        <Empty icon="🔍" title="No matching services in your area">
          <p className="muted">Try another word, like “tap”, “generator” or “wiring”.</p>
        </Empty>
      )}
      {res.data && <ServiceList services={res.data} />}
    </div>
  );
}
