import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { BookingListItem } from '../api/types';
import { Empty, ErrorBox, Spinner } from '../components/ui';
import { le, METHOD_LABEL, STATUS_LABEL, when } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const ACTIVE = ['pending', 'accepted', 'assigned', 'en_route', 'in_progress', 'disputed'];

export default function Bookings() {
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const res = useAsync(() => api<BookingListItem[]>('/bookings', { query: { scope: 'customer', limit: 100 } }), []);
  const list = (res.data ?? []).filter((b) => (tab === 'active' ? ACTIVE.includes(b.status) : !ACTIVE.includes(b.status)));
  return (
    <div className="stack">
      <h1>My bookings</h1>
      <div className="tabs">
        <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>
          Active
        </button>
        <button className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>
          Past
        </button>
      </div>
      {res.loading && <Spinner />}
      <ErrorBox error={res.error} onRetry={() => res.reload()} />
      {res.data && list.length === 0 && (
        <Empty icon="📋" title={tab === 'active' ? 'No active bookings' : 'No past bookings yet'}>
          <Link className="btn btn-primary" to="/">
            Book a fixer
          </Link>
        </Empty>
      )}
      <div className="list">
        {list.map((b) => (
          <Link key={b.id} to={`/bookings/${b.id}`} className="list-item">
            <div>
              <div className="list-title">{b.service_name}</div>
              <div className="muted small">
                {b.code} · {when(b.scheduled_at)} · {b.area}
              </div>
              <div className="small">{b.provider_name ?? 'Waiting for a fixer'}</div>
            </div>
            <div className="right">
              <span className={`status status-${b.status}`}>{STATUS_LABEL[b.status]}</span>
              <div className="price">{le(b.total_minor)}</div>
              <div className="muted small">
                {METHOD_LABEL[b.payment_method]} · {b.payment_status}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
