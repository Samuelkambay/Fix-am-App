import type { Booking, BookingListItem } from '../api';
import { dateTime, humanize, le, normalizeLocalPhone, pct, phone } from '../lib/format';
import { methodName, RATE_SOURCE_LABELS } from '../lib/labels';
import { StatusPill } from './ui';

export function AddressBlock({ area, landmark, street }: { area?: string | null; landmark?: string | null; street?: string | null }) {
  return (
    <span>
      <span className="strong">{area || 'Area not given'}</span>
      {landmark && <span className="cell-sub" style={{ display: 'block' }}>📍 {landmark}</span>}
      {street && <span className="cell-sub" style={{ display: 'block' }}>{street}</span>}
    </span>
  );
}

export function BookingDetail({ b }: { b: Booking }) {
  const bd = b.price_breakdown;
  const snap = b.commission_snapshot;
  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <div className="mono strong" style={{ fontSize: 15 }}>
            {b.code}
          </div>
          <div className="text-2">
            {b.service_name} · {b.zone_name}
          </div>
        </div>
        <div className="row">
          {b.is_emergency && <span className="pill pill-bad plain">Urgent</span>}
          <StatusPill status={b.status} />
        </div>
      </div>

      <dl className="dl">
        <dt>When</dt>
        <dd>{dateTime(b.scheduled_at)}</dd>
        <dt>Address</dt>
        <dd>
          <AddressBlock area={b.address?.area} landmark={b.address?.landmark} street={b.address?.street} />
        </dd>
        <dt>Customer</dt>
        <dd>
          {b.customer_name ?? '–'} {b.customer_phone ? `· ${phone(b.customer_phone)}` : ''}
          {b.address?.contactPhone && normalizeLocalPhone(b.address.contactPhone) !== normalizeLocalPhone(b.customer_phone ?? '') && <span className="cell-sub"> (contact {phone(b.address.contactPhone)})</span>}
        </dd>
        <dt>Provider</dt>
        <dd>{b.provider_name ?? <span className="muted">Not accepted yet</span>}</dd>
        {b.serviceman_name && (
          <>
            <dt>Serviceman</dt>
            <dd>
              {b.serviceman_name} · {phone(b.serviceman_phone)}
            </dd>
          </>
        )}
        <dt>Payment</dt>
        <dd>
          {methodName(b.payment_method)} · <StatusPill status={b.payment_status} />
        </dd>
        <dt>Channel</dt>
        <dd>{b.channel === 'ussd' ? 'USSD (feature phone)' : humanize(b.channel)}</dd>
        {b.notes && (
          <>
            <dt>Notes</dt>
            <dd>{b.notes}</dd>
          </>
        )}
        {b.cancel_reason && (
          <>
            <dt>Cancel reason</dt>
            <dd>{b.cancel_reason}</dd>
          </>
        )}
        {b.dispute_reason && (
          <>
            <dt>Dispute</dt>
            <dd className="bad">{b.dispute_reason}</dd>
          </>
        )}
        {b.review_rating != null && (
          <>
            <dt>Review</dt>
            <dd>{'★'.repeat(b.review_rating)}</dd>
          </>
        )}
      </dl>

      <div className="card" style={{ boxShadow: 'none' }}>
        <h3 style={{ marginBottom: 8 }}>Price breakdown</h3>
        <table className="lines">
          <tbody>
            {(bd?.lines?.length ? bd.lines : [{ label: 'Service', amountMinor: b.subtotal_minor }]).map((l, i) => (
              <tr key={i}>
                <td>{l.label}</td>
                <td>{le(l.amountMinor)}</td>
              </tr>
            ))}
            {b.discount_minor > 0 && (
              <tr>
                <td>Discount</td>
                <td>−{le(b.discount_minor)}</td>
              </tr>
            )}
            <tr className="total">
              <td>Total</td>
              <td>{le(b.total_minor)}</td>
            </tr>
          </tbody>
        </table>
        {bd && (
          <div className="small muted" style={{ marginTop: 8 }}>
            Unit price {le(bd.unitPriceMinor)} · demand ratio {bd.demandRatio}
            {bd.appliedRules?.length > 0 && <> · rules: {bd.appliedRules.map((r) => `${r.label} ×${r.multiplier}${r.flatFeeMinor ? ` + ${le(r.flatFeeMinor)}` : ''}`).join(', ')}</>}
            {bd.cappedBy && <> · capped by {humanize(bd.cappedBy)}</>}
          </div>
        )}
        {b.commission_minor != null && (
          <>
            <hr />
            <table className="lines">
              <tbody>
                <tr>
                  <td>
                    Commission{snap ? ` (${pct(snap.rateBps)}, ${RATE_SOURCE_LABELS[snap.rateSource] ?? snap.rateSource})` : ''}
                  </td>
                  <td>{le(b.commission_minor)}</td>
                </tr>
                <tr>
                  <td>GST on commission</td>
                  <td>{le(b.commission_gst_minor)}</td>
                </tr>
                <tr className="total">
                  <td>Provider earning</td>
                  <td>{le(b.provider_earning_minor)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>

      <div>
        <h3 style={{ marginBottom: 10 }}>Timeline</h3>
        <ol className="timeline">
          {b.events.map((e, i) => (
            <li key={i}>
              <div className="row">
                <StatusPill status={e.to_status} />
                <span className="small muted">{dateTime(e.created_at)}</span>
              </div>
              {e.note && <div className="small text-2" style={{ marginTop: 3 }}>{e.note}</div>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function BookingTable({ rows, onOpen, showProvider = true }: { rows: BookingListItem[]; onOpen: (id: string) => void; showProvider?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Booking</th>
            <th>When</th>
            <th>Area &amp; landmark</th>
            {showProvider && <th>Provider</th>}
            <th>Payment</th>
            <th className="right">Total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className="clickable" onClick={() => onOpen(b.id)}>
              <td>
                <span className="mono strong">{b.code}</span>
                <div className="cell-sub">
                  {b.service_name} · {b.zone_name}
                </div>
              </td>
              <td className="nowrap">
                {dateTime(b.scheduled_at)}
                {b.is_emergency && (
                  <div>
                    <span className="pill pill-bad plain">Urgent</span>
                  </div>
                )}
              </td>
              <td>
                <AddressBlock area={b.area} landmark={b.landmark} />
              </td>
              {showProvider && <td>{b.provider_name ?? <span className="muted">Open</span>}</td>}
              <td className="nowrap">
                {methodName(b.payment_method)}
                <div className="cell-sub">{humanize(b.payment_status)}</div>
              </td>
              <td className="right num">
                {le(b.total_minor)}
                {b.surcharge_minor > 0 && <div className="cell-sub">incl. {le(b.surcharge_minor)} peak</div>}
              </td>
              <td>
                <StatusPill status={b.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

