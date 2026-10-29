import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api';
import { Async, BarList, Card, Kpi, PageHeader, Segmented, Spinner } from '../../components/ui';
import { le, num } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { methodName } from '../../lib/labels';

// The chart library is only fetched once the KPIs are on screen.
const DailyCharts = lazy(() => import('./DailyCharts'));

type Period = '7' | '30' | '90';

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('30');
  const state = useApi(() => adminApi.dashboard(Number(period)), [period]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Bookings and money across all zones. Money totals count completed jobs."
        actions={
          <Segmented
            options={[
              { id: '7', label: '7 days' },
              { id: '30', label: '30 days' },
              { id: '90', label: '90 days' },
            ]}
            value={period}
            onChange={setPeriod}
          />
        }
      />
      <Async state={state}>
        {(d) => {
          const t = d.totals;
          const digital = t.bookings - t.cash_bookings;
          const share = (n: number) => (t.bookings ? `${Math.round((n / t.bookings) * 100)}%` : '0%');
          const platformRevenue = d.platform_ledger.filter((r) => r.account_type === 'platform_revenue').reduce((a, r) => a + Number(r.amount_minor), 0);
          return (
            <div className="stack">
              <div className="kpis">
                <Kpi label="Bookings" value={num(t.bookings)} sub={`${t.completed} completed · ${t.active} active · ${t.cancelled} cancelled`} />
                <Kpi label="GMV" value={le(t.gmv_minor)} sub="Completed job value" />
                <Kpi label="Commission" value={le(t.commission_minor)} sub={`Platform revenue (all time, ledger): ${le(platformRevenue)}`} />
                <Kpi label="GST on commission" value={le(t.gst_minor)} sub="Payable to NRA" />
                <Kpi label="Peak surcharge revenue" value={le(t.peak_surcharge_minor)} sub="Extra charged at peak times" />
                <Kpi label="Cash vs digital" value={`${share(t.cash_bookings)} cash`} sub={`${num(t.cash_bookings)} cash · ${num(digital)} mobile money/wallet`} />
                <Kpi label="USSD bookings" value={num(t.ussd_bookings)} sub={`${share(t.ussd_bookings)} of bookings from feature phones`} />
                <Kpi
                  label="Outstanding cash commission"
                  value={le(d.cash_commission_outstanding.owed_minor)}
                  sub={`${d.cash_commission_outstanding.providers} provider(s) owe commission`}
                  attention={d.cash_commission_outstanding.owed_minor > 0}
                  href="/admin/providers"
                />
                <Kpi label="Pending badge reviews" value={num(d.pending_badge_reviews)} sub="Open the verification queue" attention={d.pending_badge_reviews > 0} href="/admin/badges" />
                <Kpi
                  label="Pending payouts"
                  value={num(d.pending_payouts.n)}
                  sub={`${le(d.pending_payouts.amount_minor)} requested or approved`}
                  attention={d.pending_payouts.n > 0}
                  href="/admin/payouts"
                />
                {t.disputed > 0 && <Kpi label="Disputes" value={num(t.disputed)} sub="Need a decision" attention href="/admin/bookings" />}
              </div>

              <Card title="Daily activity" subtitle={`Last ${d.period_days} days, Freetown time`}>
                <Suspense fallback={<Spinner label="Loading chart…" />}>
                  <DailyCharts daily={d.daily} days={d.period_days} />
                </Suspense>
              </Card>

              <div className="grid grid-3">
                <Card title="By zone" subtitle="Bookings (GMV of completed jobs)">
                  <BarList rows={d.by_zone.filter((z) => z.n > 0 || z.gmv_minor > 0).map((z) => ({ label: z.name, value: z.n, extra: le(z.gmv_minor) }))} format={num} />
                </Card>
                <Card title="By category" subtitle="Bookings">
                  <BarList rows={d.by_category.map((c) => ({ label: c.name, value: c.n }))} format={num} />
                </Card>
                <Card title="By payment method" subtitle="Bookings (booked value)">
                  <BarList rows={d.by_payment_method.map((m) => ({ label: methodName(m.payment_method), value: m.n, extra: le(m.amount_minor) }))} format={num} />
                </Card>
              </div>

              <Card title="Providers" subtitle="By account status">
                <div className="row">
                  {d.providers.map((p) => (
                    <Link key={p.status} className="pill plain" to={`/admin/providers?status=${p.status}`}>
                      {p.status}: {p.n}
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          );
        }}
      </Async>
    </>
  );
}
