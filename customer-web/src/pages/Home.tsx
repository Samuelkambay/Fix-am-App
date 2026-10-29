import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Category, ProviderSummary } from '../api/types';
import { BadgeChips, ErrorBox, Stars } from '../components/ui';
import { CATEGORY_ICON } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useAsync } from '../lib/useAsync';
import { shortZone, useZone } from '../lib/zone';

export default function Home() {
  const { t } = useI18n();
  const { zone } = useZone();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const cats = useAsync(() => api<Category[]>('/catalog/categories'), []);
  const pros = useAsync(
    () => (zone ? api<ProviderSummary[]>('/providers', { query: { zoneId: zone.id, limit: 6 } }) : Promise.resolve([])),
    [zone?.id],
  );

  return (
    <div className="stack-lg">
      <section className="hero">
        <div>
          <h1>{t('heroTitle')}</h1>
          <p className="lead">{t('heroSub')}</p>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <span aria-hidden>🔎</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
            <button className="btn btn-primary" type="submit">
              Search
            </button>
          </form>
          <div className="hero-points">
            <span>🪪 ID-checked fixers</span>
            <span>📲 Orange Money · Afrimoney · QMoney</span>
            <span>💵 Or cash after the job</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden>
          <div className="hero-card">
            <div className="hero-card-row">
              <span className="dot green" /> Bright Spark Electrical
            </div>
            <div className="chips">
              <span className="chip chip-green">🪪 ID verified</span>
              <span className="chip chip-gold">⭐ Top rated</span>
            </div>
            <div className="hero-card-code">
              Start code <b>4 8 1 7</b>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>{t('trades')}</h2>
        </div>
        <ErrorBox error={cats.error} onRetry={() => cats.reload()} />
        <div className="cat-grid">
          {(cats.data ?? Array.from({ length: 9 }, () => null)).map((c, i) =>
            c ? (
              <Link key={c.id} to={`/category/${c.id}`} className="cat-card">
                <span className="cat-icon" aria-hidden>
                  {CATEGORY_ICON[c.icon ?? ''] ?? '🛠️'}
                </span>
                <span className="cat-name">{c.name}</span>
                <span className="muted small">{c.service_count} services</span>
              </Link>
            ) : (
              <div key={i} className="cat-card skeleton" />
            ),
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>
            {t('verifiedNear')} {zone && <span className="muted">· {shortZone(zone.name)}</span>}
          </h2>
        </div>
        {pros.data && pros.data.length === 0 && <p className="muted">No fixers in this area yet. Try a nearby area.</p>}
        <div className="pro-grid">
          {(pros.data ?? []).map((p) => (
            <Link key={p.id} to={`/providers/${p.id}`} className="pro-card">
              <div className="pro-avatar" aria-hidden>
                {p.business_name.slice(0, 1)}
              </div>
              <div className="pro-body">
                <div className="pro-name">
                  {p.business_name}
                  {!p.is_available && <span className="tag tag-muted">Busy</span>}
                </div>
                <Stars value={p.rating_avg} count={p.rating_count} />
                <span className="muted small"> · {p.completed_jobs} jobs</span>
                <BadgeChips codes={p.badges} max={3} />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="info-grid">
        <div className="info-card">
          <h3>🛡️ {t('howTrust')}</h3>
          <ol className="steps">
            <li>Every fixer's ID is checked. Look for the <b>ID verified</b> and <b>Background checked</b> badges.</li>
            <li>Before you open the gate, check the code on their badge on the <Link to="/verify">Verify</Link> page or by USSD.</li>
            <li>Give your <b>start code</b> only when they arrive, and your <b>completion code</b> only when you're happy.</li>
          </ol>
        </div>
        <div className="info-card">
          <h3>⏰ {t('offPeak')}</h3>
          <p>
            Prices go up a little at busy times: weekday evenings, Saturday mornings, nights, holidays and when many people need help at
            once. You always see the full price before you book, and it's locked for 15 minutes.
          </p>
          <p className="muted small">The price strip on each service shows the cheapest hours.</p>
        </div>
      </section>
    </div>
  );
}
