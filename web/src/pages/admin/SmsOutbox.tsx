import { useState } from 'react';
import { adminApi } from '../../api';
import { Async, Button, Card, Empty, PageHeader, Pager, StatusPill } from '../../components/ui';
import { dateTime, normalizeLocalPhone, phone } from '../../lib/format';
import { useApi } from '../../lib/hooks';

const LIMIT = 100;

export default function SmsOutbox() {
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('');
  const list = useApi(() => adminApi.smsOutbox(LIMIT, offset), [offset]);
  const f = filter.replace(/\D/g, '');
  const local = normalizeLocalPhone(filter);
  return (
    <>
      <PageHeader title="SMS outbox" subtitle="Every SMS the platform sent: login codes, job alerts, badge decisions, payout notices. In development, read OTP codes here." />
      <div className="filters">
        <input className="input" placeholder="Filter by phone or text" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button size="sm" variant="ghost" onClick={list.reload}>
          Refresh
        </Button>
      </div>
      <Card flush>
        <Async state={list} empty={<Empty title="No messages yet" />}>
          {(rows) => {
            const shown = filter
              ? rows.filter(
                  (m) =>
                    (local && normalizeLocalPhone(m.phone) === local) ||
                    (f.length >= 3 && m.phone.includes(f)) ||
                    m.body.toLowerCase().includes(filter.toLowerCase()),
                )
              : rows;
            return (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Sent</th>
                        <th>To</th>
                        <th>Message</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((m) => (
                        <tr key={m.id}>
                          <td className="nowrap">{dateTime(m.created_at)}</td>
                          <td className="nowrap num">{phone(m.phone)}</td>
                          <td style={{ maxWidth: 620 }}>{m.body}</td>
                          <td>
                            <StatusPill status={m.status} />
                            <div className="cell-sub">{m.provider}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {shown.length === 0 && <Empty title="No messages match the filter on this page" />}
                <Pager offset={offset} limit={LIMIT} count={rows.length} onChange={setOffset} />
              </>
            );
          }}
        </Async>
      </Card>
    </>
  );
}
