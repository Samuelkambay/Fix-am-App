import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { providersApi, type Gateway } from '../../api';
import { Button, Card, Field, Kpi, PageHeader, PhoneInput, StatusPill, Switch } from '../../components/ui';
import { date, le, normalizeLocalPhone, pct, phone as fmtPhone } from '../../lib/format';
import { explainBlocker, GATEWAYS, methodName } from '../../lib/labels';
import { useToast } from '../../lib/toast';
import { useProvider } from './context';

export default function Overview() {
  const { me, reload } = useProvider();
  const toast = useToast();
  const [savingAvail, setSavingAvail] = useState(false);
  const plan = me.commission_plan;
  const sub = me.active_subscription;
  const blockers = me.accept_blockers.map((b) => ({ code: b, ...explainBlocker(b, { owedMinor: me.commission_owed_minor, limitMinor: me.cash_commission_limit_minor }) }));
  const approvedBadges = me.badges.filter((b) => b.status === 'approved' && (!b.expires_at || new Date(b.expires_at) > new Date()));

  const toggleAvailable = async (v: boolean) => {
    setSavingAvail(true);
    try {
      await providersApi.updateMe({ isAvailable: v });
      await reload();
      toast.success(v ? 'You are online and will get job alerts' : 'You are offline – no new job alerts');
    } catch (e) {
      toast.error(e);
    } finally {
      setSavingAvail(false);
    }
  };

  return (
    <>
      <PageHeader title={`Kushe, ${me.business_name}`} subtitle="Your account at a glance." />
      <div className="stack">
        {blockers.length > 0 ? (
          <div className="stack-sm">
            {blockers.map((b) => (
              <div key={b.code} className={`banner ${b.tone === 'critical' ? 'banner-bad' : 'banner-warn'}`}>
                <span>
                  <span className="banner-icon">{b.tone === 'critical' ? '!' : '•'}</span>
                  {b.text}
                </span>
                {b.action && (
                  <Link className="btn btn-sm" to={b.action.to}>
                    {b.action.label}
                  </Link>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="banner banner-good">
            <span>
              <span className="banner-icon">✓</span>
              {me.is_available ? 'You can accept jobs. New requests in your zones appear under Jobs.' : 'Your account is ready. Switch on availability to get job alerts.'}
            </span>
            <Link className="btn btn-sm" to="/provider/jobs">
              Open jobs
            </Link>
          </div>
        )}

        <Card>
          <div className="row-between">
            <div>
              <h2>Availability</h2>
              <p className="muted small" style={{ margin: 0 }}>
                When you are offline, customers cannot find you and you get no SMS alerts.
              </p>
            </div>
            <Switch checked={me.is_available} disabled={savingAvail} onChange={toggleAvailable} label={me.is_available ? 'Online' : 'Offline'} />
          </div>
        </Card>

        <div className="kpis">
          <Kpi label="Balance" value={le(me.balance_minor)} sub={me.balance_minor >= 0 ? 'Available to withdraw' : 'Negative = commission owed'} href="/provider/wallet" />
          <Kpi
            label="Commission owed"
            value={le(me.commission_owed_minor)}
            sub={`On cash jobs · limit ${le(me.cash_commission_limit_minor)}`}
            attention={me.commission_owed_minor > 0}
            href="/provider/wallet#settle"
          />
          <Kpi label="Completed jobs" value={me.completed_jobs} sub={`${me.cancelled_jobs} cancelled`} />
          <Kpi label="Rating" value={`${Number(me.rating_avg).toFixed(1)} ★`} sub={`${me.rating_count} review${me.rating_count === 1 ? '' : 's'}`} />
          <Kpi label="Trust score" value={me.trust_score} sub={`${approvedBadges.length} valid badge(s)`} href="/provider/badges" />
        </div>

        <div className="grid grid-2">
          <Card title="Your plan" actions={<Link className="btn btn-sm" to="/provider/plans">Compare plans</Link>}>
            <dl className="dl">
              <dt>Plan</dt>
              <dd className="strong">{plan.name}</dd>
              <dt>Commission</dt>
              <dd>
                {me.commission_override_bps != null ? (
                  <>
                    {pct(me.commission_override_bps)} <span className="muted">(negotiated rate)</span>
                  </>
                ) : plan.model !== 'commission' && sub ? (
                  <>
                    {pct(plan.subscription_rate_bps)} <span className="muted">while subscribed</span>
                  </>
                ) : (
                  <>
                    {pct(plan.default_rate_bps)} <span className="muted">default{plan.tiers.length ? ', lower with volume' : ''}</span>
                  </>
                )}
              </dd>
              {plan.surcharge_rate_bps != null && (
                <>
                  <dt>On peak surcharge</dt>
                  <dd>{pct(plan.surcharge_rate_bps)}</dd>
                </>
              )}
              <dt>Subscription</dt>
              <dd>
                {sub ? (
                  <>
                    <StatusPill status="active" /> until {date(sub.ends_at)}
                  </>
                ) : plan.model !== 'commission' ? (
                  <span className="warn">Not paid – you pay the default {pct(plan.default_rate_bps)} until you renew</span>
                ) : (
                  <span className="muted">None (pay per job)</span>
                )}
              </dd>
            </dl>
          </Card>
          <Card title="Coverage" actions={<Link className="btn btn-sm" to="/provider/services">Edit</Link>}>
            <dl className="dl">
              <dt>Zones</dt>
              <dd>{me.zones.map((z) => z.name).join(', ') || <span className="warn">No zones – you will not get jobs</span>}</dd>
              <dt>Services</dt>
              <dd>
                {me.services.length} service(s){me.services.length ? `: ${me.services.slice(0, 4).map((s) => s.name).join(', ')}${me.services.length > 4 ? '…' : ''}` : ''}
              </dd>
              <dt>Badges</dt>
              <dd>{approvedBadges.map((b) => b.name).join(', ') || <span className="muted">None yet</span>}</dd>
            </dl>
          </Card>
        </div>

        <BusinessDetails />
      </div>
    </>
  );
}

function BusinessDetails() {
  const { me, reload } = useProvider();
  const toast = useToast();
  const [name, setName] = useState(me.business_name);
  const [bio, setBio] = useState(me.bio ?? '');
  const [gateway, setGateway] = useState<Gateway | ''>(me.payout_gateway ?? '');
  const [msisdn, setMsisdn] = useState(fmtPhone(me.payout_msisdn) === '–' ? '' : fmtPhone(me.payout_msisdn));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(me.business_name);
    setBio(me.bio ?? '');
    setGateway(me.payout_gateway ?? '');
  }, [me]);

  const local = normalizeLocalPhone(msisdn);
  const dirty = name !== me.business_name || bio !== (me.bio ?? '') || gateway !== (me.payout_gateway ?? '') || (local && local !== normalizeLocalPhone(me.payout_msisdn ?? ''));

  const save = async () => {
    setBusy(true);
    try {
      await providersApi.updateMe({ businessName: name.trim(), bio, payoutGateway: gateway || undefined, payoutMsisdn: local ?? undefined });
      await reload();
      toast.success('Details saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Business & payout details" subtitle="Withdrawals are sent to this mobile money number.">
      <div className="form-grid">
        <Field label="Business name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Payout wallet" hint={gateway ? `Current: ${methodName(me.payout_gateway)}` : 'Required to withdraw'}>
          <select className="select" value={gateway} onChange={(e) => setGateway(e.target.value as Gateway)}>
            <option value="" disabled>
              Choose a wallet
            </option>
            {GATEWAYS.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name} ({g.network})
              </option>
            ))}
          </select>
        </Field>
        <Field label="About your business" className="full">
          <textarea className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Field label="Payout number" error={msisdn && !local ? 'Enter a Sierra Leone number, e.g. 076 123 456' : undefined}>
          <PhoneInput value={msisdn} onChange={setMsisdn} />
        </Field>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <div>
            <Button variant="primary" busy={busy} disabled={!dirty || name.trim().length < 2 || (!!msisdn && !local)} onClick={save}>
              Save details
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
