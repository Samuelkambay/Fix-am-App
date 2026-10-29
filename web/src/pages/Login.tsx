import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { authApi, type LoginResponse } from '../api';
import { ThemeToggle } from '../components/Shell';
import { Button, ErrorBox, Field, PhoneInput, Segmented } from '../components/ui';
import { homeFor, useAuth } from '../lib/auth';
import { normalizeLocalPhone, phone as fmtPhone } from '../lib/format';

type Tab = 'provider' | 'admin';

export default function Login() {
  const { session, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('provider');

  const done = (r: LoginResponse) => {
    const s = signIn(r);
    navigate(homeFor(s.user.role), { replace: true });
  };

  if (session && (session.user.role === 'admin' || session.user.role === 'provider' || session.user.role === 'customer')) {
    return <Navigate to={homeFor(session.user.role)} replace />;
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand" style={{ color: '#fff', padding: 0 }}>
          <span className="brand-mark" style={{ background: '#fff', color: '#0b5e48' }}>
            F
          </span>
          <span>FixAm Salone</span>
        </div>
        <div>
          <h1>Trusted fixers for every home in Sierra Leone.</h1>
          <p>Manage jobs, badges, payouts and pricing for electricians, plumbers, AC and solar technicians from Freetown to Kenema.</p>
        </div>
        <p className="small hero-extra">Admin panel and provider panel. Customers book in the FixAm app, on the web or by USSD.</p>
      </section>
      <section className="login-panel">
        <div className="login-card stack">
          <div className="row-between">
            <h2>Log in</h2>
            <ThemeToggle />
          </div>
          {session && session.user.role === 'serviceman' && (
            <div className="banner banner-info">
              <span>You are logged in as a serviceman. Servicemen use the FixAm Pro mobile app.</span>
              <Button size="sm" onClick={() => signOut()}>
                Log out
              </Button>
            </div>
          )}
          <Segmented
            options={[
              { id: 'provider', label: 'Provider (SMS code)' },
              { id: 'admin', label: 'Admin' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'admin' ? <AdminLogin onDone={done} /> : <ProviderLogin onDone={done} />}
        </div>
      </section>
    </div>
  );
}

function AdminLogin({ onDone }: { onDone: (r: LoginResponse) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const valid = normalizeLocalPhone(phone);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(undefined);
    try {
      const r = await authApi.login(valid, password);
      if (r.user.role !== 'admin') throw new Error('This account is not an admin. Providers log in with an SMS code.');
      onDone(r);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack-sm" onSubmit={submit}>
      <Field label="Phone number" error={phone && !valid ? 'Enter a Sierra Leone number, e.g. 076 123 456' : undefined}>
        <PhoneInput value={phone} onChange={setPhone} autoFocus />
      </Field>
      <Field label="Password">
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {err !== undefined && <ErrorBox error={err} />}
      <Button type="submit" variant="primary" block busy={busy} disabled={!valid || !password}>
        Log in
      </Button>
    </form>
  );
}

function ProviderLogin({ onDone }: { onDone: (r: LoginResponse) => void }) {
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const [cooldown, setCooldown] = useState(0);
  const valid = normalizeLocalPhone(phone);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const request = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(undefined);
    try {
      const r = await authApi.requestOtp(valid);
      setDevCode(r.devCode);
      setStep('code');
      setCode('');
      setCooldown(30);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(undefined);
    try {
      onDone(await authApi.verifyOtp(valid, code));
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'phone')
    return (
      <form className="stack-sm" onSubmit={request}>
        <Field label="Phone number" hint="We will send a 6-digit code by SMS" error={phone && !valid ? 'Enter a Sierra Leone number, e.g. 076 123 456' : undefined}>
          <PhoneInput value={phone} onChange={setPhone} autoFocus />
        </Field>
        {err !== undefined && <ErrorBox error={err} />}
        <Button type="submit" variant="primary" block busy={busy} disabled={!valid}>
          Send code
        </Button>
      </form>
    );

  return (
    <form className="stack-sm" onSubmit={verify}>
      <p className="text-2">
        Enter the code sent to <strong>{fmtPhone(valid)}</strong>.{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('phone')}>
          Change number
        </button>
      </p>
      {devCode && (
        <div className="dev-hint">
          Dev mode: your code is <strong className="mono">{devCode}</strong>{' '}
          <button type="button" className="btn btn-sm" onClick={() => setCode(devCode)}>
            Fill in
          </button>
        </div>
      )}
      <Field label="6-digit code">
        <input
          className="input mono"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          style={{ letterSpacing: '0.3em', fontSize: 18 }}
        />
      </Field>
      {err !== undefined && <ErrorBox error={err} />}
      <Button type="submit" variant="primary" block busy={busy} disabled={code.length !== 6}>
        Verify and log in
      </Button>
      <Button variant="ghost" block disabled={cooldown > 0 || busy} onClick={() => request()}>
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </Button>
    </form>
  );
}
