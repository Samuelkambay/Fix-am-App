import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { DayCurve, ProviderSummary, Quote, Service } from '../api/types';
import { BadgeChips, ErrorBox, Spinner, Stars } from '../components/ui';
import { dayLabel, hourLabel, isoDate, le, unitText } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useAsync } from '../lib/useAsync';
import { shortZone, useZone } from '../lib/zone';

export interface PendingCheckout {
  quote: Quote;
  service: Pick<Service, 'id' | 'name' | 'price_unit' | 'unit_label'>;
  providerName: string | null;
  zoneName: string;
}

export const CHECKOUT_KEY = 'fixam.checkout';

function PriceStrip({ curve, selected, disabledBefore, onPick }: { curve: DayCurve; selected: number | null; disabledBefore: number; onPick: (h: number) => void }) {
  const max = Math.max(...curve.hours.map((h) => h.totalMinor));
  const min = Math.min(...curve.hours.map((h) => h.totalMinor));
  return (
    <div className="strip" role="radiogroup" aria-label="Time of day">
      {curve.hours.map((h) => {
        const disabled = h.hour < disabledBefore;
        const height = max === min ? 60 : 35 + ((h.totalMinor - min) / (max - min)) * 65;
        return (
          <button
            key={h.hour}
            role="radio"
            aria-checked={selected === h.hour}
            disabled={disabled}
            className={`strip-col ${h.surchargeMinor > 0 ? 'peak' : 'off'} ${selected === h.hour ? 'selected' : ''}`}
            onClick={() => onPick(h.hour)}
            title={h.labels.join(', ') || 'Standard price'}
          >
            <span className="strip-price">{le(h.totalMinor).replace('Le ', '')}</span>
            <span className="strip-bar" style={{ height: `${height}%` }}>
              {h.isCheapest && !disabled && <span className="strip-best">✓</span>}
            </span>
            <span className="strip-hour">{hourLabel(h.hour)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function ServicePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { t } = useI18n();
  const { zone } = useZone();
  const [dayOffset, setDayOffset] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [asap, setAsap] = useState(false);
  const [qty, setQty] = useState(1);
  const [providerId, setProviderId] = useState<string | null>(params.get('provider'));
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const service = useAsync(() => api<Service>(`/catalog/services/${id}`), [id]);
  const providers = useAsync(
    () => (zone ? api<ProviderSummary[]>('/providers', { query: { zoneId: zone.id, serviceId: id, limit: 20 } }) : Promise.resolve([])),
    [zone?.id, id],
  );
  const date = isoDate(dayOffset);
  const curve = useAsync(
    () => (zone ? api<DayCurve>('/pricing/day-curve', { query: { serviceId: id, zoneId: zone.id, date, providerId: providerId ?? undefined } }) : Promise.resolve(undefined)),
    [id, zone?.id, date, providerId],
  );

  // Freetown is UTC+0, so the current UTC hour is the local hour. Give fixers at least an hour's notice.
  const firstHour = dayOffset === 0 ? new Date().getUTCHours() + 2 : 0;
  const selectedHour = curve.data?.hours.find((h) => h.hour === hour && h.hour >= firstHour);
  // Suggest the cheapest open hour closest to the one picked, not just the earliest cheap slot of the day.
  const cheapest = useMemo(() => {
    const open = curve.data?.hours.filter((h) => h.hour >= firstHour) ?? [];
    if (!open.length) return undefined;
    const min = Math.min(...open.map((h) => h.totalMinor));
    const target = hour ?? 12;
    return open.filter((h) => h.totalMinor === min).sort((a, b) => Math.abs(a.hour - target) - Math.abs(b.hour - target))[0];
  }, [curve.data, firstHour, hour]);
  const saving = selectedHour && cheapest && selectedHour.totalMinor > cheapest.totalMinor ? selectedHour.totalMinor - cheapest.totalMinor : 0;
  const s = service.data;
  const days = Array.from({ length: 7 }, (_, i) => i);

  async function getQuote() {
    if (!s || !zone) return;
    const scheduledAt = asap ? new Date(Date.now() + 60 * 60_000) : selectedHour ? new Date(selectedHour.at) : null;
    if (!scheduledAt) return setError(new ApiError(400, 'pick_time', 'Pick a time, or choose Urgent.'));
    setBusy(true);
    setError(null);
    try {
      const quote = await api<Quote>('/pricing/quote', {
        body: { serviceId: s.id, zoneId: zone.id, scheduledAt: scheduledAt.toISOString(), quantity: qty, isEmergency: asap, providerId: providerId ?? undefined },
      });
      const pending: PendingCheckout = {
        quote,
        service: { id: s.id, name: s.name, price_unit: s.price_unit, unit_label: s.unit_label },
        providerName: providers.data?.find((p) => p.id === providerId)?.business_name ?? null,
        zoneName: zone.name,
      };
      sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(pending));
      nav('/checkout');
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (service.loading) return <Spinner />;
  if (!s) return <ErrorBox error={service.error ?? new Error('Service not found')} />;

  return (
    <div className="two-col">
      <div className="stack">
        <div>
          <Link to={`/category/${s.category_id}`} className="crumb">
            ← {s.category_name}
          </Link>
          <h1>{s.name}</h1>
          {s.description && <p className="lead">{s.description}</p>}
          <p className="muted">
            From <b>{le(s.base_price_minor)}</b> {unitText(s.price_unit, s.unit_label)} · about {Math.max(1, Math.round(s.duration_minutes / 60))} h
            {zone && ` · ${shortZone(zone.name)}`}
          </p>
        </div>

        <section className="card stack">
          <h3>{t('when')}</h3>
          <label className={`toggle ${asap ? 'on' : ''}`}>
            <input type="checkbox" checked={asap} onChange={(e) => setAsap(e.target.checked)} />
            <span className="toggle-track" aria-hidden />
            <span>
              🚨 {t('asap')} <span className="muted small">(urgent fee applies)</span>
            </span>
          </label>
          {!asap && (
            <>
              <div className="day-chips">
                {days.map((d) => (
                  <button key={d} className={`day-chip ${d === dayOffset ? 'selected' : ''}`} onClick={() => { setDayOffset(d); setHour(null); }}>
                    {d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : dayLabel(new Date(Date.now() + d * 86400_000).toISOString())}
                  </button>
                ))}
              </div>
              {curve.loading && <Spinner label="Checking prices…" />}
              {curve.data && <PriceStrip curve={curve.data} selected={hour} disabledBefore={firstHour} onPick={setHour} />}
              <div className="legend small">
                <span><i className="sw off" /> Standard</span>
                <span><i className="sw peak" /> Peak time</span>
                <span>✓ Cheapest</span>
              </div>
              {selectedHour && selectedHour.labels.length > 0 && (
                <div className="alert alert-warn">
                  ⏰ {selectedHour.labels.join(' + ')} at {hourLabel(selectedHour.hour)}.
                  {saving > 0 && cheapest && <> Book at <b>{hourLabel(cheapest.hour)}</b> and save <b>{le(saving)}</b>.</>}
                </div>
              )}
              {dayOffset === 0 && firstHour > 22 && <p className="muted">It's late. Pick tomorrow, or choose Urgent.</p>}
            </>
          )}
          {s.price_unit !== 'fixed' && (
            <div className="qty">
              <span>How many {s.price_unit === 'hourly' ? 'hours' : `${s.unit_label ?? 'units'}`}?</span>
              <div className="stepper">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less">−</button>
                <span>{qty}</span>
                <button onClick={() => setQty((q) => Math.min(200, q + 1))} aria-label="More">+</button>
              </div>
            </div>
          )}
        </section>

        <section className="card stack">
          <h3>Who should come?</h3>
          <button className={`pick ${providerId === null ? 'selected' : ''}`} onClick={() => setProviderId(null)}>
            <span className="pick-radio" aria-hidden />
            <div>
              <b>{t('anyProvider')}</b>
              <div className="muted small">Fastest: we send your job to every verified fixer nearby and the first to accept takes it.</div>
            </div>
          </button>
          {(providers.data ?? []).length > 0 && <div className="muted small">{t('chooseProvider')}</div>}
          {(providers.data ?? []).map((p) => (
            <button key={p.id} className={`pick ${providerId === p.id ? 'selected' : ''}`} onClick={() => setProviderId(p.id)} disabled={!p.is_available}>
              <span className="pick-radio" aria-hidden />
              <div className="grow">
                <div className="row-between">
                  <b>{p.business_name}</b>
                  <span className="price">{le(p.price_override_minor ?? s.base_price_minor)}</span>
                </div>
                <Stars value={p.rating_avg} count={p.rating_count} /> <span className="muted small">· {p.completed_jobs} jobs {!p.is_available && '· busy now'}</span>
                <BadgeChips codes={p.badges} />
                <Link to={`/providers/${p.id}`} className="small" onClick={(e) => e.stopPropagation()}>
                  View profile
                </Link>
              </div>
            </button>
          ))}
        </section>
      </div>

      <aside className="sticky">
        <div className="card stack">
          <h3>Your price</h3>
          {asap ? (
            <p className="muted">Urgent jobs include a call-out fee. You'll see the exact price on the next step.</p>
          ) : selectedHour ? (
            <div className="breakdown">
              <div className="row"><span>{dayLabel(selectedHour.at)}, {hourLabel(selectedHour.hour)}</span><span /></div>
              <div className="row row-total"><span>{qty > 1 ? `About (×${qty})` : 'About'}</span><span>{le(selectedHour.totalMinor * qty)}</span></div>
              {selectedHour.labels.length > 0 && <div className="small muted">Includes {selectedHour.labels.join(', ')}</div>}
            </div>
          ) : (
            <p className="muted">Pick a time to see your price.</p>
          )}
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-block btn-lg" disabled={busy || (!asap && !selectedHour)} onClick={getQuote}>
            {busy ? 'Locking your price…' : t('getPrice')}
          </button>
          <p className="small muted">No payment yet. Your price is locked for 15 minutes on the next screen.</p>
        </div>
      </aside>
    </div>
  );
}
