import { useState } from 'react';
import { adminApi } from '../../api';
import { Async, Button, Card, Empty, PageHeader, Pager } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';

const LIMIT = 100;

function summary(data: unknown): string {
  if (data == null) return '';
  if (typeof data !== 'object') return String(data);
  return Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default function AuditLog() {
  const [offset, setOffset] = useState(0);
  const list = useApi(() => adminApi.auditLogs(LIMIT, offset), [offset]);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who changed what: approvals, badge decisions, commission terms and settings." />
      <div className="filters">
        <Button size="sm" variant="ghost" onClick={list.reload}>
          Refresh
        </Button>
      </div>
      <Card flush>
        <Async state={list} empty={<Empty title="Nothing logged yet">Admin actions appear here.</Empty>}>
          {(rows) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id}>
                        <td className="nowrap">{dateTime(a.created_at)}</td>
                        <td>{a.actor_name ?? <span className="muted">System</span>}</td>
                        <td className="mono small">{a.action}</td>
                        <td className="small">
                          {a.entity}
                          {a.entity_id && <div className="cell-sub mono">{a.entity_id.slice(0, 8)}</div>}
                        </td>
                        <td className="small" style={{ maxWidth: 520, overflowWrap: 'anywhere' }}>
                          {summary(a.data) || '–'}
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
    </>
  );
}
