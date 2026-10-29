import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';
import { ErrorBox, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { localPhone, normalizePhone } from '../lib/format';
import { useI18n } from '../lib/i18n';

interface VerifyResponse {
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
  user: User;
}

export default function Login() {
  const { signIn } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [step, setStep] = useState<'phone' | 'code' | 'name'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const e164 = normalizePhone(phone);

  async function requestCode() {
    if (!e164) return setError(new ApiError(400, 'invalid_phone', 'Enter a Sierra Leone mobile number, e.g. 076 123 456'));
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>('/auth/otp/request', { body: { phone: e164 } });
      setDevCode(r.devCode ?? null);
      setStep('code');
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<VerifyResponse>('/auth/otp/verify', { body: { phone: e164, code, language: lang } });
      signIn({ accessToken: r.accessToken, refreshToken: r.refreshToken }, r.user);
      if (!r.user.name) setStep('name');
      else nav(next, { replace: true });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    setBusy(true);
    try {
      const u = await api<User>('/auth/me', { method: 'PATCH', body: { name } });
      signIn(JSON.parse(localStorage.getItem('fixam.auth') ?? '{}'), u);
      nav(next, { replace: true });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="card stack">
        <h1>{step === 'name' ? 'What should we call you?' : 'Log in with your phone'}</h1>
        {step === 'phone' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); requestCode(); }}>
            <Field label="Mobile number" hint="We'll send a 6-digit code by SMS. Orange, Africell and Qcell numbers all work.">
              <div className="input-prefix">
                <span>+232</span>
                <input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="076 123 456" autoFocus />
              </div>
            </Field>
            <ErrorBox error={error} />
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}
        {step === 'code' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <p className="muted">Enter the code we sent to {localPhone(e164)}.</p>
            <input
              className="input otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-label="6-digit code"
              autoFocus
            />
            {devCode && <div className="alert alert-info">Demo mode: your code is <b>{devCode}</b></div>}
            <ErrorBox error={error} />
            <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Log in'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep('phone')}>
              Use a different number
            </button>
          </form>
        )}
        {step === 'name' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
            <Field label="Your name" hint="Your fixer will see this name.">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Aminata Kamara" />
            </Field>
            <ErrorBox error={error} />
            <button className="btn btn-primary btn-block" disabled={busy || name.trim().length < 2}>
              Continue
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
