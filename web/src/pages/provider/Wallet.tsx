import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { walletApi } from '../../api';
import { PaymentFlow } from '../../components/PaymentFlow';
import { Async, Button, Card, Empty, ErrorBox, Field, Kpi, MoneyInput, PageHeader, Pager, StatusPill } from '../../components/ui';
import { dateTime, humanize, le, phone } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { ENTRY_LABELS, methodName } from '../../lib/labels';
import { useToast } from '../../lib/toast';
import { useProvider } from './context';

const LIMIT = 50;

export default function Wallet() {
  const { me, reload: reloadMe } = useProvider();
  const toast = useToast();
  const loc = useLocation();
  const [offset, setOffset] = useState(0);
  const wallet = useApi(() => walletApi.get(LIMIT, offset), [offset]);
  const payouts = useApi(() => walletApi.payouts(undefined, 50), []);
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const [paying, setPaying] = useState(false);
  const [settleAmount, setSettleAmount] = useState<number | null>(null);

  useEffect(() => {
    if (loc.hash === '#settle' && wallet.data) document.getElementById('settle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loc.hash, wallet.data]);
  useEffect(() => {
    if (wallet.data) setSettleAmount(wallet.data.commission_owed_minor || null);
  }, [wallet.data]);

  const refresh = () => {
    wallet.reload();
    payouts.reload();
    reloadMe();
  };

  const withdraw = async () => {
    if (!amount) return;
    setBusy(true);
    setErr(undefined);
    try {
      await walletApi.requestPayout(amount);
      toast.success(`Withdrawal of ${le(amount)} requested. FixAm will send it to ${phone(me.payout_msisdn)}.`);
      setAmount(null);
      refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Earnings & wallet" subtitle="Mobile money jobs add your earning here. Cash jobs subtract FixAm's commission, because you already hold the cash." />
      <Async state={wallet}>
        {(w) => {
          const maxWithdraw = Math.max(w.available_minor - w.payout_fee_minor, 0);
          const amountErr =
            amount == null ? undefined : amount < w.payout_min_minor ? `Minimum is ${le(w.payout_min_minor)}` : amount > maxWithdraw ? `You can withdraw up to ${le(maxWithdraw)}` : undefined;
          const overLimit = w.commission_owed_minor > w.cash_commission_limit_minor;
          return (
            <div className="stack">
              <div className="kpis">
                <Kpi label="Balance" value={le(w.balance_minor)} sub="Earnings minus withdrawals and cash commission" />
                <Kpi label="Available to withdraw" value={le(w.available_minor)} sub={`Minimum ${le(w.payout_min_minor)} · fee ${le(w.payout_fee_minor)}`} />
                <Kpi
                  label="Commission owed"
                  value={le(w.commission_owed_minor)}
                  sub={overLimit ? `Over the ${le(w.cash_commission_limit_minor)} limit – you cannot accept jobs` : `Limit ${le(w.cash_commission_limit_minor)}`}
                  attention={w.commission_owed_minor > 0}
                />
                <Kpi label="Pending withdrawals" value={w.pending_payouts.length} sub={le(w.pending_payouts.reduce((a, p) => a + p.amount_minor, 0))} />
              </div>

              <div className="grid grid-2">
                <Card title="Withdraw" subtitle={me.payout_msisdn ? `To ${methodName(me.payout_gateway)} ${phone(me.payout_msisdn)}` : 'Add your payout number on the Overview page first.'}>
                  <div className="stack-sm">
                    <Field label="Amount" error={amountErr}>
                      <MoneyInput value={amount} onChange={setAmount} placeholder={String(maxWithdraw / 100)} />
                    </Field>
                    <div className="row">
                      <Button variant="primary" busy={busy} disabled={!amount || !!amountErr || !me.payout_msisdn || me.status !== 'active'} onClick={withdraw}>
                        Request withdrawal
                      </Button>
                      {maxWithdraw >= w.payout_min_minor && (
                        <Button size="sm" variant="ghost" onClick={() => setAmount(maxWithdraw)}>
                          Withdraw all ({le(maxWithdraw)})
                        </Button>
                      )}
                    </div>
                    {me.status !== 'active' && <span className="small warn">Your account must be active to withdraw.</span>}
                    {err !== undefined && <ErrorBox error={err} />}
                  </div>
                </Card>
                <section id="settle" className="card">
                  <div className="card-header">
                    <div>
                      <h2>Pay commission on cash jobs</h2>
                      <p>Pay what you owe by mobile money. It clears straight away.</p>
                    </div>
                  </div>
                  {w.commission_owed_minor > 0 ? (
                    <div className="stack-sm">
                      <div className={`banner ${overLimit ? 'banner-bad' : 'banner-warn'}`}>
                        <span>
                          You owe <strong>{le(w.commission_owed_minor)}</strong>
                          {overLimit ? ' – pay now to accept new jobs.' : '.'}
                        </span>
                      </div>
                      <Field label="Amount to pay" hint="You can pay part of it">
                        <MoneyInput value={settleAmount} onChange={setSettleAmount} />
                      </Field>
                      <div>
                        <Button variant="primary" disabled={!settleAmount || settleAmount <= 0 || settleAmount > w.commission_owed_minor} onClick={() => setPaying(true)}>
                          Pay {settleAmount ? le(Math.min(settleAmount, w.commission_owed_minor)) : ''} now
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="banner banner-good">
                      <span>✓ You do not owe any commission.</span>
                    </div>
                  )}
                </section>
              </div>

              <Card title="Withdrawals" flush>
                <Async state={payouts} empty={<Empty title="No withdrawals yet" />}>
                  {(rows) => (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Requested</th>
                            <th>To</th>
                            <th className="right">Amount</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((p) => (
                            <tr key={p.id}>
                              <td>{dateTime(p.created_at)}</td>
                              <td>
                                {methodName(p.gateway)} · {phone(p.msisdn)}
                              </td>
                              <td className="right num">{le(p.amount_minor)}</td>
                              <td>
                                <StatusPill status={p.status} />
                                {p.failure_reason && <div className="cell-sub">{p.failure_reason}</div>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Async>
              </Card>

              <Card title="Ledger" subtitle="Every change to your balance" flush>
                {w.entries.length === 0 ? (
                  <Empty title="No entries yet">Completed jobs and withdrawals appear here.</Empty>
                ) : (
                  <>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Details</th>
                            <th className="right">Amount</th>
                            <th className="right">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {w.entries.map((e) => (
                            <tr key={e.id}>
                              <td className="nowrap">{dateTime(e.created_at)}</td>
                              <td>{ENTRY_LABELS[e.entry_type] ?? humanize(e.entry_type)}</td>
                              <td className="small text-2">{e.memo ?? '–'}</td>
                              <td className={`right num strong ${e.amount_minor < 0 ? 'bad' : 'good'}`}>
                                {e.amount_minor > 0 ? '+' : ''}
                                {le(e.amount_minor)}
                              </td>
                              <td className="right num">{le(e.running_balance_minor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pager offset={offset} limit={LIMIT} count={w.entries.length} onChange={setOffset} />
                  </>
                )}
              </Card>

              {paying && settleAmount && (
                <PaymentFlow
                  title="Pay commission"
                  description="FixAm commission on jobs you were paid for in cash."
                  amountMinor={Math.min(settleAmount, w.commission_owed_minor)}
                  defaultMsisdn={me.payout_msisdn ?? null}
                  buildBody={(gateway, msisdn) => ({ purpose: 'cash_settlement', amountMinor: Math.min(settleAmount, w.commission_owed_minor), gateway, msisdn })}
                  onFinished={(p) => {
                    if (p.status === 'succeeded') toast.success('Commission paid. Tenki!');
                    refresh();
                  }}
                  onClose={() => {
                    setPaying(false);
                    refresh();
                  }}
                />
              )}
            </div>
          );
        }}
      </Async>
    </>
  );
}
