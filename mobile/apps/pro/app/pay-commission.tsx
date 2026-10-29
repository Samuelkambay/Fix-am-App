import { useRouter } from 'expo-router';
import { useState } from 'react';
import { formatLe } from '@fixam/shared';
import { Banner, Button, Loading, PaymentFlow, Screen, useSession, useT } from '@fixam/shared/ui';
import { useProviderMe } from '../src/components';

/** Pays the commission owed on cash jobs (purpose cash_settlement). Unblocks accepting jobs above the limit. */
export default function PayCommission() {
  const t = useT();
  const router = useRouter();
  const { user } = useSession();
  const me = useProviderMe();
  const [done, setDone] = useState(false);
  if (!me.data) return <Loading />;
  const owed = me.data.commission_owed_minor;
  if (owed <= 0 && !done) {
    return (
      <Screen>
        <Banner tone="success" title={t('earn.paid')} />
      </Screen>
    );
  }
  return (
    <Screen footer={done ? <Button title={t('common.done')} variant="pro" onPress={() => { void me.reload(); router.back(); }} /> : undefined}>
      <Banner tone="warn" title={t('earn.payOwedHint', { limit: formatLe(me.data.cash_commission_limit_minor) })} />
      <PaymentFlow
        storeKey={`pay:settle:${owed}`}
        amountMinor={owed}
        initialGateway={me.data.payout_gateway}
        initialMsisdn={me.data.payout_msisdn ?? user?.phone ?? ''}
        buildBody={(g, m) => ({ purpose: 'cash_settlement', amountMinor: owed, gateway: g as Exclude<typeof g, 'wallet'>, msisdn: m })}
        onSuccess={() => setDone(true)}
        successLabel={t('earn.paid')}
      />
    </Screen>
  );
}
