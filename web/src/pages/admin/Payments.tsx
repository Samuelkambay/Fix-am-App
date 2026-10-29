import { useState } from 'react';
import { paymentsApi, type WebhookEvent } from '../../api';
import { Async, Button, Card, Empty, Modal, PageHeader, Pager, StatusPill, Tabs } from '../../components/ui';
import { dateTime, humanize, le, phone } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { methodName } from '../../lib/labels';

const LIMIT = 50;
const STATUSES = ['initiated', 'pending', 'succeeded', 'failed', 'expired', 'refunded'];

export default function Payments() {
  const [tab, setTab] = useState<'payments' | 'webhooks'>('payments');
  return (
    <>
      <PageHeader title="Payments" subtitle="Mobile money collections (Orange Money, Afrimoney, QMoney, Monime) and wallet payments, plus every operator callback received." />
      <Tabs
        tabs={[
          { id: 'payments', label: 'Payments' },
          { id: 'webhooks', label: 'Webhook events' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'payments' ? <PaymentsList /> : <WebhookList />}
    </>
  );
}

function PaymentsList() {
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useApi(() => paymentsApi.list({ status: status || undefined, limit: LIMIT, offset }), [status, offset]);
  return (
    <>
      <div className="filters">
        <select
          className="select"
          value={status}
          onChange={(e) => {
            setOffset(0);
            setStatus(e.target.value);
          }}
          aria-label="Status filter"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={list.reload}>
          Refresh
        </Button>
      </div>
      <Card flush>
        <Async state={list} empty={<Empty title="No payments" />}>
          {(rows) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Payer</th>
                      <th>Purpose</th>
                      <th>Wallet</th>
                      <th className="right">Amount</th>
                      <th>Status</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap">{dateTime(p.created_at)}</td>
                        <td>
                          {p.payer_name ?? '–'}
                          <div className="cell-sub">{phone(p.payer_phone)}</div>
                        </td>
                        <td>
                          {humanize(p.purpose)}
                          {p.booking_code && <div className="cell-sub mono">{p.booking_code}</div>}
                        </td>
                        <td>
                          {methodName(p.gateway)}
                          {p.msisdn && <div className="cell-sub">{phone(p.msisdn)}</div>}
                        </td>
                        <td className="right num strong">{le(p.amount_minor)}</td>
                        <td>
                          <StatusPill status={p.status} />
                          {p.failure_reason && <div className="cell-sub">{p.failure_reason.replace(/_/g, ' ')}</div>}
                        </td>
                        <td className="mono small">{p.external_ref ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} limit={LIMIT} count={rows.length} onChange={setOffset} />
            </>
          )}
        </Async>
      </Card>
    </>
  );
}

function WebhookList() {
  const [offset, setOffset] = useState(0);
  const list = useApi(() => paymentsApi.webhookEvents(LIMIT, offset), [offset]);
  const [open, setOpen] = useState<WebhookEvent | null>(null);
  return (
    <>
      <div className="filters">
        <span className="small muted">Signed callbacks from mobile money operators. Duplicates are recorded once and ignored.</span>
        <Button size="sm" variant="ghost" onClick={list.reload}>
          Refresh
        </Button>
      </div>
      <Card flush>
        <Async state={list} empty={<Empty title="No webhook events yet" />}>
          {(rows) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>Gateway</th>
                      <th>Event</th>
                      <th>Signature</th>
                      <th>Result</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((w) => (
                      <tr key={w.id}>
                        <td className="nowrap">{dateTime(w.received_at)}</td>
                        <td>{methodName(w.gateway)}</td>
                        <td className="mono small">{w.event_id}</td>
                        <td>{w.signature_ok ? <span className="pill pill-good">Valid</span> : <span className="pill pill-bad">Rejected</span>}</td>
                        <td className="small">{w.result ?? (w.processed_at ? 'processed' : '–')}</td>
                        <td className="right">
                          <Button size="sm" onClick={() => setOpen(w)}>
                            Payload
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} limit={LIMIT} count={rows.length} onChange={setOffset} />
            </>
          )}
        </Async>
      </Card>
      {open && (
        <Modal title={`Webhook ${open.event_id}`} onClose={() => setOpen(null)} size="wide">
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {JSON.stringify(open.payload, null, 2)}
          </pre>
        </Modal>
      )}
    </>
  );
}
