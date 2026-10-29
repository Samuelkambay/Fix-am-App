import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { bookingsApi } from '../../api';
import { BookingDetail, BookingTable } from '../../components/BookingDetail';
import { Async, Card, Drawer, Empty, ErrorBox, PageHeader, Pager, PromptModal, Spinner, Button, Segmented } from '../../components/ui';
import { humanize, le } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { BOOKING_STATUSES } from '../../lib/labels';
import { useToast } from '../../lib/toast';

const LIMIT = 50;
// Admin cancel goes through the normal transition table: allowed before work starts.
// Disputed jobs are settled through "Resolve" instead (see README: cancel on a disputed job does not reverse settlement).
const CANCELLABLE = ['pending', 'accepted', 'assigned', 'en_route'];

export default function Bookings() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useApi(() => bookingsApi.list('all', { status: status || undefined, limit: LIMIT, offset }), [status, offset]);

  return (
    <>
      <PageHeader title="Bookings" subtitle="Every job on the platform. Click a row for the timeline and price breakdown." />
      <div className="filters">
        <select
          className="select"
          value={status}
          onChange={(e) => {
            setOffset(0);
            setParams(e.target.value ? { status: e.target.value } : {});
          }}
          aria-label="Status filter"
        >
          <option value="">All statuses</option>
          {BOOKING_STATUSES.map((s) => (
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
        <Async state={list} empty={<Empty title="No bookings">{status ? 'Try another status.' : 'Bookings from the app, web and USSD appear here.'}</Empty>}>
          {(rows) => (
            <>
              <BookingTable rows={rows} onOpen={setOpenId} />
              <Pager offset={offset} limit={LIMIT} count={rows.length} onChange={setOffset} />
            </>
          )}
        </Async>
      </Card>
      {openId && (
        <AdminBookingDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => list.reload()}
        />
      )}
    </>
  );
}

function AdminBookingDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const b = useApi(() => bookingsApi.get(id), [id]);
  const [dialog, setDialog] = useState<null | 'cancel' | 'resolve'>(null);
  const [resolution, setResolution] = useState<'release' | 'refund'>('release');

  const after = (msg: string) => (r: unknown) => {
    toast.success(msg);
    b.reload();
    onChanged();
    return r;
  };

  const status = b.data?.status;
  return (
    <Drawer
      title="Booking"
      onClose={onClose}
      footer={
        b.data && (
          <>
            {status && CANCELLABLE.includes(status) && (
              <Button variant="danger" onClick={() => setDialog('cancel')}>
                Cancel booking
              </Button>
            )}
            {status === 'disputed' && (
              <Button variant="primary" onClick={() => setDialog('resolve')}>
                Resolve dispute
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </>
        )
      }
    >
      {b.error ? <ErrorBox error={b.error} onRetry={b.reload} /> : !b.data ? <Spinner /> : <BookingDetail b={b.data} />}
      {dialog === 'cancel' && b.data && (
        <PromptModal
          title={`Cancel ${b.data.code}`}
          label="Reason (sent to the customer and provider)"
          confirmLabel="Cancel booking"
          danger
          minLength={3}
          onClose={() => setDialog(null)}
          onSubmit={(reason) => bookingsApi.cancel(id, reason).then(after('Booking cancelled'))}
        >
          {b.data.payment_status === 'paid' && <p className="text-2">The prepayment of {le(b.data.total_minor)} will be refunded to the customer's FixAm wallet.</p>}
        </PromptModal>
      )}
      {dialog === 'resolve' && b.data && (
        <PromptModal
          title={`Resolve dispute on ${b.data.code}`}
          label="Decision note"
          confirmLabel={resolution === 'release' ? 'Release to provider' : 'Refund customer'}
          danger={resolution === 'refund'}
          minLength={3}
          onClose={() => setDialog(null)}
          onSubmit={(note) => bookingsApi.resolve(id, resolution, note).then(after(resolution === 'release' ? 'Released to provider' : 'Refunded to customer'))}
        >
          <p className="text-2">Dispute: {b.data.dispute_reason}</p>
          <Segmented
            options={[
              { id: 'release', label: 'Release to provider' },
              { id: 'refund', label: 'Refund customer' },
            ]}
            value={resolution}
            onChange={setResolution}
          />
          <p className="small muted">
            {resolution === 'release'
              ? 'Marks the job completed and settles commission as normal.'
              : 'Cancels the job, reverses any settlement and refunds a prepayment to the customer’s FixAm wallet.'}
          </p>
        </PromptModal>
      )}
    </Drawer>
  );
}
