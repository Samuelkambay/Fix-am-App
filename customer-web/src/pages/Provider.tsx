import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ProviderProfile, Review } from '../api/types';
import { BadgeChip, ErrorBox, Spinner, Stars } from '../components/ui';
import { dayLabel, le, unitText } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { shortZone } from '../lib/zone';

export default function Provider() {
  const { id } = useParams();
  const p = useAsync(() => api<ProviderProfile>(`/providers/${id}`), [id]);
  const reviews = useAsync(() => api<Review[]>(`/reviews/provider/${id}`, { query: { limit: 10 } }), [id]);
  if (p.loading) return <Spinner />;
  if (!p.data) return <ErrorBox error={p.error} />;
  const d = p.data;
  return (
    <div className="two-col">
      <div className="stack">
        <div className="profile-head">
          <div className="pro-avatar lg" aria-hidden>
            {d.business_name.slice(0, 1)}
          </div>
          <div>
            <h1>{d.business_name}</h1>
            <Stars value={d.rating_avg} count={d.rating_count} /> <span className="muted">· {d.completed_jobs} jobs · {d.kind === 'company' ? 'Company' : 'Individual'}</span>
            <div className="muted small">Works in {d.zones.map((z) => shortZone(z.name)).join(', ')}</div>
          </div>
        </div>
        {d.bio && <p className="lead">{d.bio}</p>}

        <section className="card stack">
          <h3>Badges</h3>
          {d.badges.map((b) => (
            <div key={b.code} className="badge-row">
              <BadgeChip code={b.code} label={b.name} />
              <span className="muted small">
                Code <Link to={`/verify/${b.verification_code}`}>{b.verification_code}</Link>
                {b.expires_at && ` · until ${dayLabel(b.expires_at)}`}
              </span>
            </div>
          ))}
        </section>

        <section className="card">
          <h3>Reviews</h3>
          {reviews.data && reviews.data.length === 0 && <p className="muted">No reviews yet.</p>}
          {(reviews.data ?? []).map((r, i) => (
            <div key={i} className="review">
              <div>
                <span className="stars">{'★'.repeat(r.rating)}</span> <b>{r.customer_first_name ?? 'Customer'}</b>
                <span className="muted small"> · {r.service_name} · {dayLabel(r.created_at)}</span>
              </div>
              {r.comment && <p>{r.comment}</p>}
            </div>
          ))}
        </section>
      </div>
      <aside className="sticky">
        <div className="card">
          <h3>Book {d.business_name.split(' ')[0]}</h3>
          <div className="list list-flat">
            {d.services.map((s) => (
              <Link key={s.id} to={`/service/${s.id}?provider=${d.id}`} className="list-item">
                <span>{s.name}</span>
                <span className="price">
                  {le(s.price_minor)}
                  <span className="muted small"> {unitText(s.price_unit, s.unit_label)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
