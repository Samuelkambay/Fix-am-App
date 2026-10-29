import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { shortZone, useZone } from '../lib/zone';

export function ZonePicker({ onClose }: { onClose: () => void }) {
  const { zones, zone, setZone, locate } = useZone();
  const { t } = useI18n();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cities = [...new Set(zones.map((z) => z.city))];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={t('chooseArea')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('chooseArea')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <button
          className="btn btn-outline btn-block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const err = await locate();
            setBusy(false);
            if (err) setMsg(err);
            else onClose();
          }}
        >
          📍 {busy ? 'Finding you…' : t('useLocation')}
        </button>
        {msg && <p className="alert alert-warn">{msg}</p>}
        {cities.map((city) => (
          <div key={city} className="zone-group">
            <div className="zone-city">{city}</div>
            {zones
              .filter((z) => z.city === city)
              .map((z) => (
                <button
                  key={z.id}
                  className={`zone-item ${zone?.id === z.id ? 'selected' : ''}`}
                  onClick={() => {
                    setZone(z);
                    onClose();
                  }}
                >
                  {shortZone(z.name)}
                  <span className="muted small">{z.district}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavItem({ to, icon, label, end }: { to: string; icon: string; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <span className="nav-icon" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
    </NavLink>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const { zone } = useZone();
  const { t, lang, setLang } = useI18n();
  const [picking, setPicking] = useState(false);
  return (
    <div className="app">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand" aria-label="FixAm home">
            <span className="brand-mark" aria-hidden>
              🔧
            </span>
            <span className="brand-text">
              Fix<span>Am</span>
            </span>
          </Link>
          <button className="zone-btn" onClick={() => setPicking(true)} aria-label={t('chooseArea')}>
            📍 <span>{zone ? shortZone(zone.name) : t('chooseArea')}</span> ▾
          </button>
          <nav className="top-nav">
            <NavItem to="/" icon="🏠" label={t('home')} end />
            <NavItem to="/bookings" icon="📋" label={t('bookings')} />
            <NavItem to="/verify" icon="🛡️" label={t('verify')} />
            <NavItem to="/wallet" icon="👛" label={t('wallet')} />
          </nav>
          <div className="topbar-right">
            <button className="lang-btn" onClick={() => setLang(lang === 'en' ? 'kri' : 'en')} aria-label="Switch language">
              {lang === 'en' ? 'Krio' : 'English'}
            </button>
            {user ? (
              <Link className="avatar" to="/profile" aria-label={t('profile')}>
                {(user.name ?? user.phone).slice(0, 1).toUpperCase()}
              </Link>
            ) : (
              <Link className="btn btn-sm btn-primary" to="/login">
                {t('login')}
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="container main">{children ?? <Outlet />}</main>
      <footer className="footer container">
        <span>FixAm Salone · Freetown · Bo · Kenema · Makeni · Koidu</span>
        <span>No smartphone? Dial the FixAm USSD code to book from any phone.</span>
      </footer>
      <nav className="bottom-nav">
        <NavItem to="/" icon="🏠" label={t('home')} end />
        <NavItem to="/bookings" icon="📋" label={t('bookings')} />
        <NavItem to="/verify" icon="🛡️" label={t('verify')} />
        <NavItem to="/wallet" icon="👛" label={t('wallet')} />
        <NavItem to={user ? '/profile' : '/login'} icon="👤" label={user ? t('profile') : t('login')} />
      </nav>
      {picking && <ZonePicker onClose={() => setPicking(false)} />}
    </div>
  );
}
