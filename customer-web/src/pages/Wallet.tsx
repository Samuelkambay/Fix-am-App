import { useState } from 'react';
import { api } from '../api/client';
import type { WalletEntry } from '../api/types';
import { PaymentFlow } from '../components/PaymentFlow';
import { Empty, ErrorBox, Spinner } from '../components/ui';
import { le, when } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const ENTRY_LABEL: Record<string, string> = {
  topup: 'Top-up',
  booking_payment: 'Paid for a booking',
  refund: 'Refund',
};

export default function Wallet() {
  const res = useAsync(() => api<{ balance_minor: number; entries: WalletEntry[] }>('/wallet'), []);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [toppingUp, setToppingUp] = useState(false);
  const chosen = amount ?? (Number(custom) > 0 ? Math.round(Number(custom) * 100) : null);

  return (
    <div className="two-col">
      <div className="stack">
        <div className="balance-card">
          <span className="small">FixAm wallet</span>
          <span className="balance">{res.data ? le(res.data.balance_minor) : '…'}</span>
          <span className="small">Pay for jobs instantly. Refunds land here straight away.</span>
        </div>
        <ErrorBox error={res.error} onRetry={() => res.reload()} />
        <section className="card">
          <h3>History</h3>
          {res.loading && <Spinner />}
          {res.data && res.data.entries.length === 0 && <Empty icon="👛" title="No transactions yet" />}
          <div className="list list-flat">
            {(res.data?.entries ?? []).map((e) => (
              <div key={e.id} className="list-item">
                <div>
                  <div className="list-title">{ENTRY_LABEL[e.entry_type] ?? e.entry_type}</div>
                  <div className="muted small">
                    {e.memo} · {when(e.created_at)}
                  </div>
                </div>
                <div className={`amount ${e.amount_minor < 0 ? 'neg' : 'pos'}`}>
                  {e.amount_minor > 0 ? '+' : ''}
                  {le(e.amount_minor)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <aside className="sticky">
        {!toppingUp ? (
          <div className="card stack">
            <h3>Top up</h3>
            <div className="amount-chips">
              {[5000, 10000, 20000, 50000].map((a) => (
                <button key={a} className={`day-chip ${amount === a ? 'selected' : ''}`} onClick={() => { setAmount(a); setCustom(''); }}>
                  {le(a)}
                </button>
              ))}
            </div>
            <input className="input" inputMode="decimal" placeholder="Other amount (Le)" value={custom} onChange={(e) => { setCustom(e.target.value); setAmount(null); }} />
            <button className="btn btn-primary btn-block" disabled={!chosen || chosen < 1000} onClick={() => setToppingUp(true)}>
              Continue
            </button>
            <p className="small muted">Minimum Le 10.</p>
          </div>
        ) : (
          <div className="stack">
            <PaymentFlow
              target={{ purpose: 'wallet_topup', amountMinor: chosen! }}
              allowWallet={false}
              onPaid={() => {
                res.reload(true);
                setTimeout(() => setToppingUp(false), 1500);
              }}
            />
            <button className="btn btn-ghost btn-block" onClick={() => setToppingUp(false)}>
              Back
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
