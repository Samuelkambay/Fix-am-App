import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Category as Cat, Service } from '../api/types';
import { Empty, ErrorBox, Spinner } from '../components/ui';
import { CATEGORY_ICON } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { shortZone, useZone } from '../lib/zone';
import { ServiceList } from './Search';

export default function Category() {
  const { id } = useParams();
  const { zone } = useZone();
  const cats = useAsync(() => api<Cat[]>('/catalog/categories'), []);
  const services = useAsync(() => api<Service[]>('/catalog/services', { query: { categoryId: id, zoneId: zone?.id } }), [id, zone?.id]);
  const cat = cats.data?.find((c) => c.id === id);
  return (
    <div className="stack">
      <div className="page-head">
        <span className="cat-icon lg" aria-hidden>
          {CATEGORY_ICON[cat?.icon ?? ''] ?? '🛠️'}
        </span>
        <div>
          <h1>{cat?.name ?? 'Services'}</h1>
          {zone && <p className="muted">Available in {shortZone(zone.name)}</p>}
        </div>
      </div>
      {services.loading && <Spinner />}
      <ErrorBox error={services.error} onRetry={() => services.reload()} />
      {services.data && services.data.length === 0 && (
        <Empty icon="🧭" title="No fixers for this trade in your area yet">
          <p className="muted">Change your area at the top of the page, or check back soon.</p>
        </Empty>
      )}
      {services.data && <ServiceList services={services.data} />}
    </div>
  );
}
