import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';
import { ErrorBox, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { localPhone } from '../lib/format';
import { useI18n } from '../lib/i18n';

export default function Profile() {
  const { user, signOut, reload } = useAuth();
  const { lang, setLang } = useI18n();
  const nav = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  if (!user) return null;
  return (
    <div className="narrow stack">
      <h1>Profile</h1>
      <div className="card stack">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
        </Field>
        <Field label="Phone">
          <input className="input" value={localPhone(user.phone)} disabled />
        </Field>
        <Field label="Language">
          <div className="seg">
            {(['en', 'kri'] as const).map((l) => (
              <button
                key={l}
                className={lang === l ? 'active' : ''}
                onClick={async () => {
                  setLang(l);
                  await api<User>('/auth/me', { method: 'PATCH', body: { language: l } }).catch(() => {});
                }}
              >
                {l === 'en' ? 'English' : 'Krio'}
              </button>
            ))}
          </div>
        </Field>
        <ErrorBox error={error} />
        <button
          className="btn btn-primary"
          disabled={name.trim().length < 2}
          onClick={async () => {
            try {
              await api<User>('/auth/me', { method: 'PATCH', body: { name: name.trim() } });
              await reload();
              setSaved(true);
            } catch (e) {
              setError(e as ApiError);
            }
          }}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      <div className="card stack">
        <h3>Are you a fixer?</h3>
        <p className="muted">Get jobs near you, get paid by mobile money, and earn verified badges. Download the FixAm Pro app to register.</p>
      </div>
      <button
        className="btn btn-danger-ghost"
        onClick={() => {
          signOut();
          nav('/');
        }}
      >
        Log out
      </button>
    </div>
  );
}
