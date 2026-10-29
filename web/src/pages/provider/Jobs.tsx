import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, bookingsApi, providersApi, type Booking, type BookingListItem } from '../../api';
import { AddressBlock, BookingDetail, BookingTable } from '../../components/BookingDetail';
import { Async, Button, Card, Drawer, Empty, ErrorBox, Field, Modal, PageHeader, PromptModal, Spinner, Tabs } from '../../components/ui';
import { dateTime, humanize, le, relative } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { explainBlocker, methodName } from '../../lib/labels';
import { useToast } from '../../lib/toast';
import { useProvider } from './context';

type Tab = 'requests' | 'mine';
const ACTIVE = ['accepted', 'assigned', 'en_route', 'in_progress'];

export default function Jobs() {
  const [tab, setTab] = useState<Tab>('requests');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const requests = useApi(() => bookingsApi.list('requests', { limit: 100 }), []);
  const mine = useApi(() => bookingsApi.list('provider', { status: status || undefined, limit: 100 }), [status]);
  const reloadAll = () => {
    requests.reload();
    mine.reload();
  };

  const activeCount = (mine.data ?? []).filter((b) => ACTIVE.includes(b.status)).length;

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Open requests in your zones, and the jobs you have taken."
        actions={
          <Button size="sm" variant="ghost" onClick={reloadAll}>
            Refresh
          </Button>
        }
      />
      <Tabs
        tabs={[
          { id: 'requests', label: `Job requests${requests.data ? ` (${requests.data.length})` : ''}` },
          { id: 'mine', label: `My jobs${activeCount ? ` (${activeCount} active)` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'requests' ? (
        <Requests state={requests} onOpen={setOpenId} onAccepted={reloadAll} />
      ) : (
        <>
          <div className="filters">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
              <option value="">All my jobs</option>
              {['accepted', 'assigned', 'en_route', 'in_progress', 'completed', 'disputed', 'cancelled'].map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </div>
          <Card flush>
            <Async state={mine} empty={<Empty title="No jobs yet">Accept a request to see it here.</Empty>}>
              {(rows) => <BookingTable rows={rows} onOpen={setOpenId} showProvider={false} />}
            </Async>
          </Card>
        </>
      )}
      {openId && <JobDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} />}
    </>
  );
}

function Requests({
  state,
  onOpen,
  onAccepted,
}: {
  state: { data: BookingListItem[] | undefined; error: unknown; loading: boolean; reload: () => void };
  onOpen: (id: string) => void;
  onAccepted: () => void;
}) {
  const { me, reload } = useProvider();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const blockers = me.accept_blockers.map((b) => explainBlocker(b, { owedMinor: me.commission_owed_minor, limitMinor: me.cash_commission_limit_minor }));

  const accept = async (b: BookingListItem) => {
    setBusy(b.id);
    try {
      await bookingsApi.accept(b.id);
      toast.success(`You accepted ${b.code}. The customer has been told.`);
      onAccepted();
      onOpen(b.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_taken') toast.error('Another provider took this job first.');
      else toast.error(e);
      onAccepted();
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      {blockers.length > 0 && (
        <div className="banner banner-warn">
          <span>{blockers[0].text}</span>
          {blockers[0].action && (
            <Link className="btn btn-sm" to={blockers[0].action.to}>
              {blockers[0].action.label}
            </Link>
          )}
        </div>
      )}
      <Async state={state} empty={<Card><Empty title="No open requests right now">New jobs for your services in {me.zones.map((z) => z.name).join(', ') || 'your zones'} appear here. You also get an SMS.</Empty></Card>}>
        {(rows) => (
          <div className="grid grid-2">
            {rows.map((b) => (
              <Card key={b.id}>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <h3>{b.service_name}</h3>
                    <div className="small muted">
                      <span className="mono">{b.code}</span> · posted {relative(b.created_at)}
                    </div>
                  </div>
                  <div className="right">
                    <div className="kpi-value" style={{ fontSize: 18 }}>
                      {le(b.total_minor)}
                    </div>
                    {b.surcharge_minor > 0 && <span className="pill pill-warn plain">incl. {le(b.surcharge_minor)} peak</span>}
                  </div>
                </div>
                <dl className="dl small" style={{ marginTop: 10 }}>
                  <dt>When</dt>
                  <dd>
                    {dateTime(b.scheduled_at)} {b.is_emergency && <span className="pill pill-bad plain">Urgent</span>}
                  </dd>
                  <dt>Where</dt>
                  <dd>
                    <AddressBlock area={b.area} landmark={b.landmark} />
                    <span className="cell-sub">{b.zone_name}</span>
                  </dd>
                  <dt>Payment</dt>
                  <dd>{methodName(b.payment_method)}</dd>
                </dl>
                <div className="row" style={{ marginTop: 12 }}>
                  <Button variant="primary" busy={busy === b.id} disabled={!me.can_accept_jobs} onClick={() => accept(b)} title={me.can_accept_jobs ? undefined : blockers[0]?.text}>
                    Accept job
                  </Button>
                  <Button onClick={() => onOpen(b.id)}>Details</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Async>
    </div>
  );
}

function JobDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { me, reload: reloadMe } = useProvider();
  const toast = useToast();
  const b = useApi(() => bookingsApi.get(id), [id]);
  const [dialog, setDialog] = useState<null | 'assign' | 'start' | 'complete' | 'cancel'>(null);
  const [busy, setBusy] = useState(false);

  const done = (msg: string) => (next: Booking) => {
    b.setData(next);
    toast.success(msg);
    onChanged();
    if (next.status === 'completed') reloadMe();
  };

  const enRoute = async () => {
    setBusy(true);
    try {
      done('Customer told you are on the way')(await bookingsApi.enRoute(id));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    setBusy(true);
    try {
      done('Job accepted')(await bookingsApi.accept(id));
    } catch (e) {
      toast.error(e);
      b.reload();
    } finally {
      setBusy(false);
    }
  };

  const s = b.data?.status;
  const mine = b.data?.provider_id === me.id;
  return (
    <Drawer
      title="Job"
      onClose={onClose}
      footer={
        b.data && (
          <>
            {s === 'pending' && !mine && (
              <Button variant="primary" busy={busy} disabled={!me.can_accept_jobs} onClick={accept}>
                Accept job
              </Button>
            )}
            {mine && (s === 'accepted' || s === 'assigned') && (
              <>
                <Button onClick={() => setDialog('assign')}>{s === 'assigned' ? 'Reassign' : 'Assign serviceman'}</Button>
                <Button variant="primary" busy={busy} onClick={enRoute}>
                  Mark en route
                </Button>
              </>
            )}
            {mine && s === 'en_route' && (
              <Button variant="primary" onClick={() => setDialog('start')}>
                Start job (code)
              </Button>
            )}
            {mine && s === 'in_progress' && (
              <Button variant="primary" onClick={() => setDialog('complete')}>
                Complete job (code)
              </Button>
            )}
            {mine && s && ['accepted', 'assigned', 'en_route'].includes(s) && (
              <Button variant="danger" onClick={() => setDialog('cancel')}>
                Withdraw
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </>
        )
      }
    >
      {b.error ? <ErrorBox error={b.error} onRetry={b.reload} /> : !b.data ? <Spinner /> : <BookingDetail b={b.data} />}
      {dialog === 'assign' && <AssignModal bookingId={id} current={b.data?.serviceman_id ?? null} onClose={() => setDialog(null)} onDone={done('Serviceman assigned')} />}
      {(dialog === 'start' || dialog === 'complete') && (
        <CodeModal
          kind={dialog}
          onClose={() => setDialog(null)}
          onSubmit={(code) => (dialog === 'start' ? bookingsApi.start(id, code).then(done('Job started')) : bookingsApi.complete(id, code).then(done('Job completed. Well done!')))}
        />
      )}
      {dialog === 'cancel' && (
        <PromptModal
          title="Withdraw from this job"
          label="Reason (the customer will see it)"
          confirmLabel="Withdraw"
          danger
          minLength={3}
          onClose={() => setDialog(null)}
          onSubmit={(reason) => bookingsApi.cancel(id, reason).then(done('You withdrew from the job'))}
        >
          <p className="text-2">Withdrawing counts against your reliability badge. Open jobs go back to other providers.</p>
        </PromptModal>
      )}
    </Drawer>
  );
}

function AssignModal({ bookingId, current, onClose, onDone }: { bookingId: string; current: string | null; onClose: () => void; onDone: (b: Booking) => void }) {
  const team = useApi(() => providersApi.servicemen(), []);
  const [pick, setPick] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const active = (team.data ?? []).filter((s) => s.active);

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      onDone(await bookingsApi.assign(bookingId, pick));
      onClose();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Assign a serviceman"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!pick || pick === current} onClick={save}>
            Assign
          </Button>
        </>
      }
    >
      {team.error ? (
        <ErrorBox error={team.error} onRetry={team.reload} />
      ) : !team.data ? (
        <Spinner />
      ) : active.length === 0 ? (
        <Empty title="No active team members">
          <Link to="/provider/team">Add a serviceman</Link> first.
        </Empty>
      ) : (
        <div className="stack-sm">
          {active.map((s) => (
            <label key={s.id} className={`card ${pick === s.id ? 'plan-card current' : ''}`} style={{ padding: 10, cursor: 'pointer' }}>
              <span className="row-between">
                <span className="row">
                  <input type="radio" name="sm" checked={pick === s.id} onChange={() => setPick(s.id)} />
                  <span className="strong">{s.name}</span>
                </span>
                <span className="small muted">{s.active_jobs} active job(s)</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {err !== undefined && <ErrorBox error={err} />}
    </Modal>
  );
}

function CodeModal({ kind, onClose, onSubmit }: { kind: 'start' | 'complete'; onClose: () => void; onSubmit: (code: string) => Promise<unknown> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const submit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await onSubmit(code);
      onClose();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={kind === 'start' ? 'Start the job' : 'Complete the job'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={code.length !== 4} onClick={submit}>
            {kind === 'start' ? 'Start job' : 'Complete job'}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <p className="text-2">
          {kind === 'start'
            ? 'Ask the customer for the 4-digit start code from their app or SMS. It proves you arrived.'
            : 'When the customer is happy with the work, ask for their 4-digit completion code.'}
        </p>
        <Field label={kind === 'start' ? 'Start code' : 'Completion code'}>
          <input
            className="input mono"
            autoFocus
            inputMode="numeric"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 4 && submit()}
            style={{ fontSize: 24, letterSpacing: '0.5em', maxWidth: 180 }}
          />
        </Field>
        {err !== undefined && <ErrorBox error={err} />}
      </div>
    </Modal>
  );
}

