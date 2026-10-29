import { useState } from 'react';
import { badgesApi, uploadsApi, type BadgeDefinition, type BadgeDocument, type ProviderBadge } from '../../api';
import { Async, Button, ErrorBox, Field, Modal, PageHeader, StatusPill } from '../../components/ui';
import { date } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { docLabel } from '../../lib/labels';
import { useToast } from '../../lib/toast';
import { useProvider } from './context';

const MAX_BYTES = 5 * 1024 * 1024;
const NUMBERED = new Set(['id_document', 'police_clearance', 'business_registration', 'tax_certificate', 'trade_certificate']);

/** Phone photos are often 3–8 MB. Shrink them before upload so it works on slow 3G and stays under the 5 MB limit. */
async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 700 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function latestFor(code: string, mine: ProviderBadge[]): ProviderBadge | undefined {
  const rows = mine.filter((b) => b.badge_code === code);
  return rows.find((b) => b.status === 'approved' || b.status === 'pending') ?? rows[0];
}

export default function Badges() {
  const { me, reload } = useProvider();
  const defs = useApi(() => badgesApi.definitions(), []);
  const mine = useApi(() => badgesApi.mine(), []);
  const [applying, setApplying] = useState<BadgeDefinition | null>(null);
  const missing = me.accept_blockers.filter((b) => b.startsWith('missing_badge:')).map((b) => b.split(':')[1]);

  return (
    <>
      <PageHeader title="Badges" subtitle="Verified badges build customer trust and move you up in search. Customers can check your badge code before letting you in." />
      {missing.length > 0 && (
        <div className="banner banner-warn" style={{ marginBottom: 16 }}>
          <span>
            <span className="banner-icon">•</span>You need {missing.map((m) => defs.data?.find((d) => d.code === m)?.name ?? m).join(', ')} before you can accept jobs.
          </span>
        </div>
      )}
      <Async state={{ data: defs.data && mine.data ? { defs: defs.data, mine: mine.data } : undefined, error: defs.error ?? mine.error, loading: defs.loading || mine.loading, reload: () => (defs.reload(), mine.reload()) }}>
        {({ defs: ds, mine: ms }) => (
          <div className="stack">
            {(['verification', 'performance'] as const).map((kind) => (
              <div key={kind}>
                <h2 style={{ marginBottom: 10 }}>{kind === 'verification' ? 'Verification badges' : 'Performance badges'}</h2>
                <div className="grid grid-3">
                  {ds
                    .filter((d) => d.kind === kind)
                    .map((d) => (
                      <BadgeCard key={d.code} def={d} badge={latestFor(d.code, ms)} required={missing.includes(d.code)} onApply={() => setApplying(d)} />
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Async>
      {applying && (
        <ApplyModal
          def={applying}
          onClose={() => setApplying(null)}
          onDone={() => {
            setApplying(null);
            mine.reload();
            reload();
          }}
        />
      )}
    </>
  );
}

function BadgeCard({ def, badge, required, onApply }: { def: BadgeDefinition; badge?: ProviderBadge; required: boolean; onApply: () => void }) {
  const expired = badge?.expires_at && new Date(badge.expires_at) <= new Date();
  const valid = badge?.status === 'approved' && !expired;
  const renewSoon = valid && badge?.expires_at && new Date(badge.expires_at).getTime() - Date.now() < 30 * 86400_000;
  const canApply = def.kind === 'verification' && def.required_documents.length > 0 && (!badge || ['rejected', 'revoked', 'expired'].includes(badge.status) || expired || renewSoon);
  const status = !badge ? null : expired ? 'expired' : badge.status;

  return (
    <div className={`card badge-card ${required ? 'plan-card current' : ''}`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className={`badge-icon ${valid ? '' : 'dim'}`}>{valid ? '✓' : def.name.charAt(0)}</span>
          <div>
            <h3>{def.name}</h3>
            <span className="small muted">+{def.trust_weight} trust</span>
          </div>
        </div>
        {status ? <StatusPill status={status} /> : <span className="pill plain">Not started</span>}
      </div>
      <p className="small text-2">{def.description}</p>
      {def.kind === 'verification' && def.required_documents.length > 0 && (
        <div className="small muted">Needs: {def.required_documents.map(docLabel).join(', ')}{def.validity_days ? ` · valid ${Math.round(def.validity_days / 365) >= 1 ? `${Math.round(def.validity_days / 365)} year(s)` : `${def.validity_days} days`}` : ''}</div>
      )}
      {def.kind === 'performance' && <div className="small muted">Earned automatically from your ratings and completed jobs.</div>}
      {valid && (
        <div>
          <div className="small muted">Verification code – show customers</div>
          <span className="code-display">{badge!.verification_code}</span>
          {badge!.expires_at && <div className={`small ${renewSoon ? 'warn' : 'muted'}`} style={{ marginTop: 4 }}>Valid until {date(badge!.expires_at)}</div>}
        </div>
      )}
      {badge?.status === 'pending' && <div className="small">Under review since {date(badge.created_at)}. We will SMS you.</div>}
      {badge && ['rejected', 'revoked'].includes(badge.status) && badge.review_note && <div className="small bad">FixAm: {badge.review_note}</div>}
      {canApply && (
        <div style={{ marginTop: 'auto' }}>
          <Button variant={required ? 'primary' : 'secondary'} size="sm" onClick={onApply}>
            {renewSoon ? 'Renew' : badge ? 'Apply again' : 'Apply'}
          </Button>
        </div>
      )}
    </div>
  );
}

function ApplyModal({ def, onClose, onDone }: { def: BadgeDefinition; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>();
  const ready = def.required_documents.every((t) => files[t]);

  const submit = async () => {
    setErr(undefined);
    try {
      const docs: BadgeDocument[] = [];
      for (const [i, type] of def.required_documents.entries()) {
        setProgress(`Uploading ${i + 1} of ${def.required_documents.length}: ${docLabel(type)}…`);
        const blob = await shrinkImage(files[type]!);
        if (blob.size > MAX_BYTES) throw new Error(`${docLabel(type)} is larger than 5 MB. Take a smaller photo or scan.`);
        const up = await uploadsApi.upload(blob);
        docs.push({ type, url: up.url, ...(numbers[type]?.trim() ? { number: numbers[type].trim() } : {}) });
      }
      setProgress('Submitting application…');
      await badgesApi.apply(def.code, docs);
      toast.success(`${def.name} submitted for review. We will SMS you the decision.`);
      onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal
      title={`Apply for “${def.name}”`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={!!progress}>
            Cancel
          </Button>
          <Button variant="primary" busy={!!progress} disabled={!ready} onClick={submit}>
            Submit for review
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <p className="text-2">{def.description}</p>
        <p className="small muted">Photos or PDF scans, up to 5 MB each. Only FixAm staff can see your documents.</p>
        {def.required_documents.map((t) => (
          <div key={t} className="card" style={{ boxShadow: 'none', padding: 12 }}>
            <Field label={docLabel(t)} hint={files[t] ? `${files[t]!.name} · ${(files[t]!.size / 1024 / 1024).toFixed(1)} MB` : undefined}>
              <input
                type="file"
                className="input"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                capture={t === 'selfie' ? 'user' : undefined}
                onChange={(e) => setFiles((f) => ({ ...f, [t]: e.target.files?.[0] ?? null }))}
              />
            </Field>
            {NUMBERED.has(t) && (
              <Field label="Document number (optional)">
                <input className="input mono" value={numbers[t] ?? ''} maxLength={60} onChange={(e) => setNumbers((n) => ({ ...n, [t]: e.target.value }))} />
              </Field>
            )}
          </div>
        ))}
        {progress && <div className="small muted">{progress}</div>}
        {err !== undefined && <ErrorBox error={err} />}
      </div>
    </Modal>
  );
}
