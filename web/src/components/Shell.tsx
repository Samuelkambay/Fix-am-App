import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { phone } from '../lib/format';
import { applyTheme, getThemePref, type ThemePref } from '../lib/theme';
import { Button, Spinner } from './ui';

export interface NavItem {
  to: string;
  label: string;
  count?: number;
  section?: string;
}

export function Shell({ nav, area, badge }: { nav: NavItem[]; area: string; badge?: ReactNode }) {
  const { session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);

  let lastSection: string | undefined;
  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <div className="scrim" onClick={() => setOpen(false)} />
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark">F</span>
          <span>
            FixAm Salone
            <small>{area}</small>
          </span>
        </div>
        {nav.map((item) => {
          const header = item.section && item.section !== lastSection ? item.section : null;
          lastSection = item.section ?? lastSection;
          return (
            <div key={item.to}>
              {header && <div className="nav-section">{header}</div>}
              <NavLink to={item.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span>{item.label}</span>
                {item.count ? <span className="nav-count">{item.count}</span> : null}
              </NavLink>
            </div>
          );
        })}
      </nav>
      <div className="main">
        <header className="topbar">
          <Button variant="ghost" className="menu-btn icon-btn" aria-label="Open menu" onClick={() => setOpen(true)}>
            ☰
          </Button>
          {badge}
          <div className="spacer" />
          <ThemeToggle />
          <span className="small text-2 nowrap user-name" title={session?.user.phone}>
            {session?.user.name ?? phone(session?.user.phone)}
          </span>
          <Button
            size="sm"
            onClick={async () => {
              await signOut();
              navigate('/login', { replace: true });
            }}
          >
            Log out
          </Button>
        </header>
        <main className="content">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const next: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
  const label: Record<ThemePref, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };
  return (
    <Button
      size="sm"
      variant="ghost"
      title={`Theme: ${label[pref]} (click to switch)`}
      aria-label={`Theme: ${label[pref]}`}
      onClick={() => {
        const n = next[pref];
        applyTheme(n);
        setPref(n);
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
      </svg>
      <span className="theme-label">{label[pref]}</span>
    </Button>
  );
}
