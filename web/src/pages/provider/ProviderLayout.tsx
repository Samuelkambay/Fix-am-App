import { useMemo } from 'react';
import { providersApi } from '../../api';
import { Shell, type NavItem } from '../../components/Shell';
import { ErrorBox, Spinner } from '../../components/ui';
import { useApi } from '../../lib/hooks';
import { ProviderContext } from './context';

export default function ProviderLayout() {
  const me = useApi(() => providersApi.me(), []);

  const ctx = useMemo(() => (me.data ? { me: me.data, reload: me.reload } : null), [me.data, me.reload]);

  if (me.error) {
    return (
      <div className="content" style={{ margin: '40px auto', maxWidth: 560 }}>
        <ErrorBox error={me.error} onRetry={me.reload} />
      </div>
    );
  }
  if (!ctx) return <Spinner label="Loading your account…" />;

  const p = ctx.me;
  const nav: NavItem[] = [
    { to: '/provider/overview', label: 'Overview' },
    { to: '/provider/jobs', label: 'Jobs' },
    { to: '/provider/wallet', label: 'Earnings & wallet', count: p.commission_owed_minor > p.cash_commission_limit_minor ? 1 : undefined },
    { to: '/provider/badges', label: 'Badges', count: p.accept_blockers.filter((b) => b.startsWith('missing_badge')).length || undefined },
    { to: '/provider/plans', label: 'Plans' },
    { to: '/provider/services', label: 'Services & zones' },
    { to: '/provider/team', label: 'Team' },
  ];
  const badge = (
    <span className="row nowrap topbar-badge" style={{ minWidth: 0 }}>
      <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.business_name}</strong>
      {p.status !== 'active' ? (
        <span className="pill pill-warn">{p.status === 'pending' ? 'Pending approval' : 'Suspended'}</span>
      ) : p.can_accept_jobs && p.is_available ? (
        <span className="pill pill-good">Taking jobs</span>
      ) : (
        <span className="pill">{p.is_available ? 'Cannot accept jobs' : 'Offline'}</span>
      )}
    </span>
  );
  return (
    <ProviderContext.Provider value={ctx}>
      <Shell nav={nav} area="Provider panel" badge={badge} />
    </ProviderContext.Provider>
  );
}
