import { useState, type FormEvent } from 'react';
import { badgesApi, type BadgeVerifyResult } from '../api';
import { date, humanize } from '../lib/format';
import { Button, ErrorBox } from './ui';

const REASONS: Record<string, string> = {
  unknown_code: 'No badge has this code. Do not let the person in until you check with FixAm.',
  expired: 'This badge has expired.',
  provider_inactive: 'This provider is not active on FixAm right now.',
  revoked: 'This badge was revoked by FixAm.',
  rejected: 'This badge application was rejected.',
  pending: 'This badge is still under review – it is not verified yet.',
};

/** Public check of a badge code (FXB-XXXXXX) a handyman shows on their ID card. */
export function BadgeVerifier({ initialCode = '' }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [result, setResult] = useState<BadgeVerifyResult | null>(null);
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setErr(undefined);
    try {
      setResult(await badgesApi.verify(code));
    } catch (x) {
      setErr(x);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-sm">
      <form className="row" onSubmit={submit}>
        <input
          className="input mono"
          style={{ maxWidth: 220, textTransform: 'uppercase' }}
          placeholder="FXB-ABC234"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          aria-label="Badge code"
        />
        <Button type="submit" variant="primary" busy={busy} disabled={!code.trim()}>
          Check code
        </Button>
      </form>
      {err !== undefined && <ErrorBox error={err} />}
      {result && (
        <div className={`banner ${result.valid ? 'banner-good' : 'banner-bad'}`} style={{ display: 'block' }}>
          <div className="strong" style={{ marginBottom: 4 }}>
            {result.valid ? '✓ Genuine FixAm badge' : '✕ Not valid'}
          </div>
          {!result.valid && <p>{REASONS[result.reason ?? ''] ?? humanize(result.reason)}</p>}
          {result.badge && (
            <dl className="dl small">
              <dt>Badge</dt>
              <dd>{result.badge}</dd>
              <dt>Provider</dt>
              <dd>{result.provider}</dd>
              <dt>Name</dt>
              <dd>{result.ownerName ?? '–'}</dd>
              <dt>Rating</dt>
              <dd>
                {result.rating != null ? `${Number(result.rating).toFixed(1)} ★` : '–'} · {result.completedJobs ?? 0} jobs
              </dd>
              <dt>Issued</dt>
              <dd>{date(result.issuedAt)}</dd>
              <dt>Expires</dt>
              <dd>{result.expiresAt ? date(result.expiresAt) : 'No expiry'}</dd>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
