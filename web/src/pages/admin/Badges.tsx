import { useState } from 'react';
import { badgesApi, type BadgeApplication, type BadgeStatus } from '../../api';
import { BadgeVerifier } from '../../components/BadgeVerifier';
import { DocumentViewer } from '../../components/DocumentViewer';
import { Async, Button, Card, Empty, PageHeader, PromptModal, StatusPill, Tabs } from '../../components/ui';
import { date, dateTime, phone, relative } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { docLabel } from '../../lib/labels';
import { useToast } from '../../lib/toast';

const TABS: { id: BadgeStatus; label: string }[] = [
  { id: 'pending', label: 'Waiting for review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'revoked', label: 'Revoked' },
  { id: 'expired', label: 'Expired' },
];

export default function Badges() {
  const toast = useToast();
  const [tab, setTab] = useState<BadgeStatus>('pending');
  const list = useApi(() => badgesApi.applications(tab, 200), [tab]);
  const defs = useApi(() => badgesApi.definitions(), []);
  const [viewing, setViewing] = useState<{ app: BadgeApplication; index: number } | null>(null);
  const [rejecting, setRejecting] = useState<BadgeApplication | null>(null);
  const [revoking, setRevoking] = useState<BadgeApplication | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const approve = async (a: BadgeApplication) => {
    setBusy(a.id);
    try {
      await badgesApi.review(a.id, 'approve');
      toast.success(`${a.badge_name} approved for ${a.business_name}. They were sent an SMS.`);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const required = (code: string) => defs.data?.find((d) => d.code === code)?.required_documents ?? [];

  return (
    <>
      <PageHeader title="Badge verification" subtitle="Check documents against the badge rules, then approve or reject. Providers get an SMS either way." />
      <div className="grid grid-sidebar">
        <div>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          <Async
            state={list}
            empty={
              <Card>
                <Empty title={tab === 'pending' ? 'Queue is empty' : `No ${tab} badges`}>{tab === 'pending' ? 'New applications from providers appear here.' : null}</Empty>
              </Card>
            }
          >
            {(apps) => (
              <div className="stack">
                {apps.map((a) => {
                  const req = required(a.badge_code);
                  const missing = req.filter((t) => !a.documents.some((d) => d.type === t));
                  return (
                    <Card key={a.id}>
                      <div className="row-between" style={{ alignItems: 'flex-start' }}>
                        <div className="row" style={{ alignItems: 'flex-start' }}>
                          <span className="badge-icon">{a.badge_name.charAt(0)}</span>
                          <div>
                            <h3>{a.badge_name}</h3>
                            <div className="text-2">
                              {a.business_name} · {a.owner_name ?? '–'} · {phone(a.owner_phone)}
                            </div>
                            <div className="small muted">
                              Applied {relative(a.created_at)} ({dateTime(a.created_at)}) · code <span className="mono">{a.verification_code}</span>
                            </div>
                          </div>
                        </div>
                        <StatusPill status={a.status} />
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <div className="small strong text-2" style={{ marginBottom: 6 }}>
                          Documents
                        </div>
                        {a.documents.length === 0 ? (
                          <span className="muted small">No documents (system-granted badge)</span>
                        ) : (
                          <div className="row">
                            {a.documents.map((d, i) => (
                              <Button key={i} size="sm" onClick={() => setViewing({ app: a, index: i })}>
                                📄 {docLabel(d.type)}
                                {d.number ? ` · ${d.number}` : ''}
                              </Button>
                            ))}
                          </div>
                        )}
                        {missing.length > 0 && <div className="small bad" style={{ marginTop: 6 }}>Missing: {missing.map(docLabel).join(', ')}</div>}
                      </div>
                      {(a.review_note || a.expires_at || a.issued_at) && (
                        <div className="small text-2" style={{ marginTop: 10 }}>
                          {a.issued_at && <>Issued {date(a.issued_at)}. </>}
                          {a.expires_at && <>Expires {date(a.expires_at)}. </>}
                          {a.review_note && <>Note: {a.review_note}</>}
                        </div>
                      )}
                      {a.status === 'pending' && (
                        <div className="row" style={{ marginTop: 14 }}>
                          <Button variant="primary" busy={busy === a.id} onClick={() => approve(a)}>
                            Approve
                          </Button>
                          <Button variant="danger" onClick={() => setRejecting(a)}>
                            Reject…
                          </Button>
                        </div>
                      )}
                      {a.status === 'approved' && (
                        <div className="row" style={{ marginTop: 14 }}>
                          <Button variant="danger" size="sm" onClick={() => setRevoking(a)}>
                            Revoke…
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </Async>
        </div>
        <div className="stack">
          <Card title="Verify a badge code" subtitle="The same public check customers use at the gate (GET /badges/verify/:code).">
            <BadgeVerifier />
          </Card>
          <Card title="Badge rules">
            <Async state={defs}>
              {(ds) => (
                <div className="stack-sm">
                  {ds.map((d) => (
                    <div key={d.code} className="small">
                      <div className="row-between">
                        <span className="strong">{d.name}</span>
                        <span className="muted">+{d.trust_weight} trust</span>
                      </div>
                      <div className="muted">
                        {d.kind === 'performance'
                          ? 'Automatic from job history'
                          : d.required_documents.length
                            ? `Needs: ${d.required_documents.map(docLabel).join(', ')}`
                            : 'Granted automatically'}
                        {d.validity_days ? ` · valid ${d.validity_days} days` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Async>
          </Card>
        </div>
      </div>
      {viewing && (
        <DocumentViewer docs={viewing.app.documents} initial={viewing.index} title={`${viewing.app.badge_name} – ${viewing.app.business_name}`} onClose={() => setViewing(null)} />
      )}
      {rejecting && (
        <PromptModal
          title={`Reject ${rejecting.badge_name}`}
          label="Tell the provider why (sent by SMS)"
          hint="e.g. The selfie does not match the ID photo. Please retake in daylight."
          confirmLabel="Reject"
          danger
          minLength={3}
          onClose={() => setRejecting(null)}
          onSubmit={(note) =>
            badgesApi.review(rejecting.id, 'reject', note).then(() => {
              toast.success('Application rejected');
              list.reload();
            })
          }
        />
      )}
      {revoking && (
        <PromptModal
          title={`Revoke ${revoking.badge_name} from ${revoking.business_name}`}
          label="Reason"
          confirmLabel="Revoke"
          danger
          minLength={3}
          onClose={() => setRevoking(null)}
          onSubmit={(note) =>
            badgesApi.revoke(revoking.id, note).then(() => {
              toast.success('Badge revoked');
              list.reload();
            })
          }
        />
      )}
    </>
  );
}
