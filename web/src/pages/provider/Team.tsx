import { useState } from 'react';
import { providersApi, type Serviceman } from '../../api';
import { Async, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, PhoneInput, StatusPill } from '../../components/ui';
import { date, normalizeLocalPhone, phone } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { useToast } from '../../lib/toast';

export default function Team() {
  const toast = useToast();
  const list = useApi(() => providersApi.servicemen(), []);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Serviceman | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const setActive = async (s: Serviceman, active: boolean) => {
    setBusy(s.id);
    try {
      await providersApi.setServicemanActive(s.id, active);
      toast.success(active ? `${s.name} is back on the team` : `${s.name} was removed from the team`);
      setConfirm(null);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Servicemen you can send to jobs. They log in to the FixAm Pro app with their own phone number."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Add serviceman
          </Button>
        }
      />
      <Card flush>
        <Async state={list} empty={<Empty title="No team members yet">Add the people who work with you so you can assign them jobs.</Empty>}>
          {(rows) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th className="right">Active jobs</th>
                    <th>Added</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td className="strong">{s.name ?? '–'}</td>
                      <td className="num">{phone(s.phone)}</td>
                      <td className="right num">{s.active_jobs}</td>
                      <td>{date(s.created_at)}</td>
                      <td>
                        <StatusPill status={s.active ? 'active' : 'cancelled'} label={s.active ? 'Active' : 'Deactivated'} />
                      </td>
                      <td className="right">
                        {s.active ? (
                          <Button size="sm" variant="danger" onClick={() => setConfirm(s)}>
                            Deactivate
                          </Button>
                        ) : (
                          <Button size="sm" busy={busy === s.id} onClick={() => setActive(s, true)}>
                            Reactivate
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
      {adding && (
        <AddModal
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            list.reload();
          }}
        />
      )}
      {confirm && (
        <Modal
          title={`Deactivate ${confirm.name}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" busy={busy === confirm.id} onClick={() => setActive(confirm, false)}>
                Deactivate
              </Button>
            </>
          }
        >
          <p>They will no longer be able to see or work on your jobs.{confirm.active_jobs > 0 && ` They still have ${confirm.active_jobs} active job(s) – reassign those first.`}</p>
        </Modal>
      )}
    </>
  );
}

function AddModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [ph, setPh] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const local = normalizeLocalPhone(ph);

  const save = async () => {
    if (!local) return;
    setBusy(true);
    setErr(undefined);
    try {
      await providersApi.addServiceman(name.trim(), local);
      toast.success(`${name.trim()} added. We sent them an SMS with login steps.`);
      onAdded();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a serviceman"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={name.trim().length < 2 || !local} onClick={save}>
            Add to team
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <Field label="Full name">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ibrahim Bangura" />
        </Field>
        <Field label="Phone number" hint="They log in with an SMS code sent to this number" error={ph && !local ? 'Enter a Sierra Leone number, e.g. 078 444 444' : undefined}>
          <PhoneInput value={ph} onChange={setPh} />
        </Field>
        {err !== undefined && <ErrorBox error={err} />}
      </div>
    </Modal>
  );
}
