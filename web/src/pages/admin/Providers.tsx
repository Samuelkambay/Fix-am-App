import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi, badgesApi, commissionApi, providersApi, type AdminProvider, type BadgeApplication, type BadgeStatus, type ProviderStatus } from '../../api';
import { DocumentViewer } from '../../components/DocumentViewer';
import { Async, Button, Card, Drawer, Empty, ErrorBox, Field, PageHeader, Pager, PercentInput, PromptModal, Spinner, StatusPill } from '../../components/ui';
import { date, le, pct, phone } from '../../lib/format';
import { useApi, useDebounced } from '../../lib/hooks';
import { methodName } from '../../lib/labels';
import { useToast } from '../../lib/toast';

const LIMIT = 50;
const BADGE_STATUSES: BadgeStatus[] = ['approved', 'pending', 'rejected', 'revoked', 'expired'];

export default function Providers() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 350);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useApi(() => adminApi.providers({ status: status || undefined, q: q || undefined, limit: LIMIT, offset }), [status, q, offset]);
  useEffect(() => setOffset(0), [status, q]);

  const open = list.data?.find((p) => p.id === openId);

  return (
    <>
      <PageHeader title="Providers" subtitle="Approve new fixers, suspend bad actors and set commission terms." />
      <div className="filters">
        <select className="select" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})} aria-label="Status filter">
          <option value="">All statuses</option>
          <option value="pending">Pending approval</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <input className="input" placeholder="Search business or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
      </div>
      <Card flush>
        <Async state={list} empty={<Empty title="No providers match" />}>
          {(rows) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Zones</th>
                      <th>Plan</th>
                      <th className="right">Balance</th>
                      <th className="right">Rating</th>
                      <th className="right">Trust</th>
                      <th>Badges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="clickable" onClick={() => setOpenId(p.id)}>
                        <td>
                          <span className="strong">{p.business_name}</span>
                          <div className="cell-sub">
                            {p.owner_name ?? '–'} · {phone(p.owner_phone)}
                          </div>
                        </td>
                        <td>
                          <StatusPill status={p.status} />
                          {!p.is_available && <div className="cell-sub">Unavailable</div>}
                        </td>
                        <td className="small">{p.zones.join(', ') || '–'}</td>
                        <td className="small">
                          {p.plan_name ?? '–'}
                          {p.commission_override_bps != null && <div className="cell-sub">Override {pct(p.commission_override_bps)}</div>}
                        </td>
                        <td className={`right num ${p.balance_minor < 0 ? 'bad' : ''}`}>
                          {le(p.balance_minor)}
                          {p.balance_minor < 0 && <div className="cell-sub">owes commission</div>}
                        </td>
                        <td className="right num">
                          {Number(p.rating_avg).toFixed(1)} <span className="cell-sub">({p.rating_count})</span>
                        </td>
                        <td className="right num">{p.trust_score}</td>
                        <td>{p.pending_badges > 0 ? <span className="pill pill-warn">{p.pending_badges} to review</span> : <span className="muted">–</span>}</td>
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
      {open && <ProviderDrawer p={open} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}

function ProviderDrawer({ p, onClose, onChanged }: { p: AdminProvider; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'suspend' | 'activate' | 'pending'>(null);
  const plans = useApi(() => commissionApi.allPlans(), []);
  // There is no admin endpoint for one provider's badges, so read every status from the review queue and filter.
  const badges = useApi(
    () => Promise.all(BADGE_STATUSES.map((s) => badgesApi.applications(s, 200))).then((all) => all.flat().filter((b) => b.provider_id === p.id)),
    [p.id],
  );
  const [planId, setPlanId] = useState(p.commission_plan_id ?? '');
  const [override, setOverride] = useState<number | null>(p.commission_override_bps);
  const [saving, setSaving] = useState(false);
  const [revoke, setRevoke] = useState<BadgeApplication | null>(null);
  const [viewing, setViewing] = useState<BadgeApplication | null>(null);

  useEffect(() => {
    setPlanId(p.commission_plan_id ?? '');
    setOverride(p.commission_override_bps);
  }, [p]);

  const setStatus = (status: ProviderStatus) => (note: string) =>
    providersApi.setStatus(p.id, status, note || undefined).then(() => {
      toast.success(status === 'active' ? 'Provider is active' : status === 'suspended' ? 'Provider suspended' : 'Moved back to pending');
      onChanged();
    });

  const saveCommission = async () => {
    setSaving(true);
    try {
      await commissionApi.setProvider(p.id, { planId: planId || undefined, overrideBps: override });
      toast.success('Commission terms saved');
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const dirty = planId !== (p.commission_plan_id ?? '') || override !== p.commission_override_bps;

  return (
    <Drawer
      title={p.business_name}
      onClose={onClose}
      footer={
        <>
          {p.status === 'pending' && (
            <Button variant="primary" onClick={() => setDialog('activate')}>
              Approve
            </Button>
          )}
          {p.status === 'suspended' && (
            <Button variant="primary" onClick={() => setDialog('activate')}>
              Reactivate
            </Button>
          )}
          {p.status !== 'suspended' && (
            <Button variant="danger" onClick={() => setDialog('suspend')}>
              Suspend
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <StatusPill status={p.status} />
          <span className="pill plain">{p.kind}</span>
          <span className="pill plain">{p.is_available ? 'Available' : 'Not available'}</span>
        </div>
        <dl className="dl">
          <dt>Owner</dt>
          <dd>
            {p.owner_name ?? '–'} · {phone(p.owner_phone)}
          </dd>
          <dt>Bio</dt>
          <dd>{p.bio ?? '–'}</dd>
          <dt>Zones</dt>
          <dd>{p.zones.join(', ') || '–'}</dd>
          <dt>Payout</dt>
          <dd>
            {methodName(p.payout_gateway)} · {phone(p.payout_msisdn)}
          </dd>
          <dt>Balance</dt>
          <dd className={p.balance_minor < 0 ? 'bad strong' : 'strong'}>
            {le(p.balance_minor)} {p.balance_minor < 0 && '(commission owed on cash jobs)'}
          </dd>
          <dt>Jobs</dt>
          <dd>
            {p.completed_jobs} completed · {p.cancelled_jobs} cancelled · {Number(p.rating_avg).toFixed(2)}★ from {p.rating_count} review{p.rating_count === 1 ? "" : "s"}
          </dd>
          <dt>Trust score</dt>
          <dd>{p.trust_score}</dd>
          <dt>Joined</dt>
          <dd>{date(p.created_at)}</dd>
        </dl>

        <Card title="Commission terms" subtitle="A negotiated override beats every plan rate. Leave it empty to use the plan.">
          {plans.error ? (
            <ErrorBox error={plans.error} onRetry={plans.reload} />
          ) : (
            <div className="form-grid">
              <Field label="Plan">
                <select className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  {(plans.data ?? []).map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                      {pl.active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Negotiated rate" hint="Empty = no override">
                <PercentInput value={override} onChange={setOverride} placeholder="none" />
              </Field>
              <div className="full row">
                <Button variant="primary" size="sm" busy={saving} disabled={!dirty} onClick={saveCommission}>
                  Save terms
                </Button>
                {override != null && (
                  <Button size="sm" variant="ghost" onClick={() => setOverride(null)}>
                    Clear override
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card title="Badges">
          {badges.error ? (
            <ErrorBox error={badges.error} onRetry={badges.reload} />
          ) : !badges.data ? (
            <Spinner />
          ) : badges.data.length === 0 ? (
            <Empty title="No badges yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {badges.data.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <span className="strong">{b.badge_name}</span>
                        <div className="cell-sub mono">{b.verification_code}</div>
                      </td>
                      <td>
                        <StatusPill status={b.status} />
                        {b.expires_at && <div className="cell-sub">until {date(b.expires_at)}</div>}
                        {b.review_note && <div className="cell-sub">{b.review_note}</div>}
                      </td>
                      <td className="right">
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          {b.documents?.length > 0 && (
                            <Button size="sm" onClick={() => setViewing(b)}>
                              Documents
                            </Button>
                          )}
                          {b.status === 'approved' && (
                            <Button size="sm" variant="danger" onClick={() => setRevoke(b)}>
                              Revoke
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {dialog === 'suspend' && (
        <PromptModal title={`Suspend ${p.business_name}`} label="Reason (sent to the provider by SMS)" confirmLabel="Suspend" danger onClose={() => setDialog(null)} onSubmit={setStatus('suspended')} />
      )}
      {dialog === 'activate' && (
        <PromptModal
          title={p.status === 'pending' ? `Approve ${p.business_name}` : `Reactivate ${p.business_name}`}
          label="Note (optional, for the audit log)"
          confirmLabel={p.status === 'pending' ? 'Approve' : 'Reactivate'}
          onClose={() => setDialog(null)}
          onSubmit={setStatus('active')}
        >
          {p.pending_badges > 0 && <div className="banner banner-warn">This provider has {p.pending_badges} badge application(s) waiting for review.</div>}
        </PromptModal>
      )}
      {revoke && (
        <PromptModal
          title={`Revoke "${revoke.badge_name}"`}
          label="Reason"
          confirmLabel="Revoke badge"
          danger
          minLength={3}
          onClose={() => setRevoke(null)}
          onSubmit={(note) =>
            badgesApi.revoke(revoke.id, note).then(() => {
              toast.success('Badge revoked');
              badges.reload();
              onChanged();
            })
          }
        />
      )}
      {viewing && <DocumentViewer docs={viewing.documents} title={`${viewing.badge_name} – ${p.business_name}`} onClose={() => setViewing(null)} />}
    </Drawer>
  );
}
