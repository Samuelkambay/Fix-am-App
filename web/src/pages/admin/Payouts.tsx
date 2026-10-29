import { useState } from 'react';
import { walletApi, type Payout } from '../../api';
import { Async, Button, Card, Empty, PageHeader, PromptModal, StatusPill } from '../../components/ui';
import { dateTime, humanize, le, phone } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { methodName } from '../../lib/labels';
import { useToast } from '../../lib/toast';

const STATUSES = ['requested', 'approved', 'processing', 'paid', 'failed', 'rejected'];

export default function Payouts() {
  const toast = useToast();
  const [status, setStatus] = useState('requested');
  const list = useApi(() => walletApi.payouts(status || undefined, 200), [status]);
  const [dialog, setDialog] = useState<{ kind: 'reject' | 'paid'; p: Payout } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const approve = async (p: Payout) => {
    setBusy(p.id);
    try {
      const r = await walletApi.approvePayout(p.id);
      toast.success(
        r.status === 'approved'
          ? `Approved. ${methodName(p.gateway)} has no payout API configured – pay from the operator portal, then mark it paid.`
          : `Payout ${humanize(r.status).toLowerCase()}`,
      );
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const total = (list.data ?? []).reduce((a, p) => a + p.amount_minor, 0);

  return (
    <>
      <PageHeader title="Payouts" subtitle="Provider withdrawals to mobile money. The amount is held from the provider's balance when they request it; rejecting returns it." />
      <div className="filters">
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
        {list.data && list.data.length > 0 && (
          <span className="small muted">
            {list.data.length} payout(s) · {le(total)}
          </span>
        )}
      </div>
      <Card flush>
        <Async state={list} empty={<Empty title={status ? `No ${status} payouts` : 'No payouts'} />}>
          {(rows) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Provider</th>
                    <th>To</th>
                    <th className="right">Amount</th>
                    <th className="right">Fee</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="nowrap">{dateTime(p.created_at)}</td>
                      <td className="strong">{p.business_name}</td>
                      <td>
                        {methodName(p.gateway)}
                        <div className="cell-sub">{phone(p.msisdn)}</div>
                      </td>
                      <td className="right num strong">{le(p.amount_minor)}</td>
                      <td className="right num">{le(p.fee_minor)}</td>
                      <td>
                        <StatusPill status={p.status} />
                        {p.external_ref && <div className="cell-sub mono">Ref {p.external_ref}</div>}
                        {p.failure_reason && <div className="cell-sub">{p.failure_reason}</div>}
                      </td>
                      <td className="right nowrap">
                        {p.status === 'requested' && (
                          <>
                            <Button size="sm" variant="primary" busy={busy === p.id} onClick={() => approve(p)}>
                              Approve
                            </Button>{' '}
                          </>
                        )}
                        {(p.status === 'approved' || p.status === 'processing') && (
                          <>
                            <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'paid', p })}>
                              Mark paid
                            </Button>{' '}
                          </>
                        )}
                        {['requested', 'approved', 'processing'].includes(p.status) && (
                          <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'reject', p })}>
                            Reject
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </Card>
      {dialog?.kind === 'reject' && (
        <PromptModal
          title={`Reject ${le(dialog.p.amount_minor)} to ${dialog.p.business_name}`}
          label="Reason"
          confirmLabel="Reject payout"
          danger
          minLength={3}
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            walletApi.rejectPayout(dialog.p.id, reason).then(() => {
              toast.success('Payout rejected and the money returned to the provider');
              list.reload();
            })
          }
        />
      )}
      {dialog?.kind === 'paid' && (
        <PromptModal
          title={`Mark ${le(dialog.p.amount_minor)} as paid`}
          label="Operator transaction reference"
          hint={`From the ${methodName(dialog.p.gateway)} merchant portal`}
          confirmLabel="Mark paid"
          multiline={false}
          minLength={3}
          onClose={() => setDialog(null)}
          onSubmit={(ref) =>
            walletApi.markPaid(dialog.p.id, ref).then(() => {
              toast.success('Marked paid. The provider was sent an SMS.');
              list.reload();
            })
          }
        >
          <p className="text-2">
            Send {le(dialog.p.amount_minor)} to {phone(dialog.p.msisdn)} ({methodName(dialog.p.gateway)}) first.
          </p>
        </PromptModal>
      )}
    </>
  );
}
