import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { badgesApi, walletApi } from '../../api';
import { Shell, type NavItem } from '../../components/Shell';

export default function AdminLayout() {
  const [counts, setCounts] = useState({ badges: 0, payouts: 0 });
  const loc = useLocation();

  // Small attention counters for the nav. Refreshed on navigation so they follow the admin's work.
  useEffect(() => {
    let cancelled = false;
    Promise.all([badgesApi.applications('pending', 200), walletApi.payouts('requested', 200)])
      .then(([b, p]) => !cancelled && setCounts({ badges: b.length, payouts: p.length }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loc.pathname]);

  const nav: NavItem[] = [
    { to: '/admin/dashboard', label: 'Dashboard', section: 'Overview' },
    { to: '/admin/bookings', label: 'Bookings', section: 'Operations' },
    { to: '/admin/providers', label: 'Providers', section: 'Operations' },
    { to: '/admin/badges', label: 'Badge verification', count: counts.badges, section: 'Operations' },
    { to: '/admin/payments', label: 'Payments', section: 'Money' },
    { to: '/admin/payouts', label: 'Payouts', count: counts.payouts, section: 'Money' },
    { to: '/admin/commission', label: 'Commission plans', section: 'Money' },
    { to: '/admin/pricing', label: 'Peak pricing', section: 'Money' },
    { to: '/admin/catalog', label: 'Catalog', section: 'Setup' },
    { to: '/admin/zones', label: 'Zones', section: 'Setup' },
    { to: '/admin/settings', label: 'Settings', section: 'Setup' },
    { to: '/admin/sms', label: 'SMS outbox', section: 'Logs' },
    { to: '/admin/audit', label: 'Audit log', section: 'Logs' },
  ];
  return <Shell nav={nav} area="Admin panel" />;
}
