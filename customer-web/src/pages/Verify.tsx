import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { BadgeCheck } from '../api/types';
import { ErrorBox } from '../components/ui';
import { BADGE_ICON, dayLabel } from '../lib/format';

const REASON: Record<string, string> = {
  unknown_code: 'This code does not exist.',
  expired: 'This badge has expired.',
  revoked: 'This badge was withdrawn by FixAm.',
  provider_inactive: 'This fixer is not active on FixAm.',
  pending: 'This badge has not been approved yet.',
  rejected: 'This badge was not approved.',
};

export default function Verify() {
  const params = useParams();
  const nav = useNavigate();
  const [code, setCode] = useState(params.code ?? '');
  const [result, setResult] = useState<BadgeCheck | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(c: string) {
    const value = c.trim().toUpperCase();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api<BadgeCheck>(`/badges/verify/${encodeURIComponent(value)}`));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (params.code) check(params.code);
  }, [params.code]);

  return (
    <div className="narrow stack">
      <h1>Verify a fixer</h1>
      <p className="lead">Before you let anyone into your home, type the code from their FixAm badge.</p>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          nav(`/verify/${encodeURIComponent(code.trim().toUpperCase())}`, { replace: true });
          check(code);
        }}
      >
        <input className="input input-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="FXB-ABC234" aria-label="Badge code" autoCapitalize="characters" />
        <button className="btn btn-primary btn-block btn-lg" disabled={busy || code.trim().length < 4}>
          {busy ? 'Checking…' : 'Check code'}
        </button>
        <p className="small muted">No data? Dial the FixAm USSD code and choose 3 to check a badge from any phone.</p>
      </form>
      <ErrorBox error={error} />
      {result && (
        <div className={`verdict ${result.valid ? 'valid' : 'invalid'}`} data-testid="verdict" role="status">
          <div className="verdict-icon" aria-hidden>
            {result.valid ? '✓' : '✕'}
          </div>
          <h2>{result.valid ? 'VALID' : 'NOT VALID'}</h2>
          {result.valid ? (
            <>
              <p className="verdict-badge">
                {BADGE_ICON[result.badgeCode ?? ''] ?? '🛡️'} {result.badge}
              </p>
              <p>
                <b>{result.provider}</b>
                {result.ownerName && ` · ${result.ownerName}`}
              </p>
              <p className="small">
                ★ {Number(result.rating ?? 0).toFixed(1)} · {result.completedJobs} jobs · issued {result.issuedAt && dayLabel(result.issuedAt)}
                {result.expiresAt && ` · valid until ${dayLabel(result.expiresAt)}`}
              </p>
              <p className="small">Make sure the person at your gate matches this name.</p>
            </>
          ) : (
            <>
              <p>{REASON[result.reason ?? ''] ?? 'This badge cannot be trusted.'}</p>
              <p>
                <b>Do not let this person in.</b> Call FixAm support.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
