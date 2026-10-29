import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { formatLe } from '@fixam/shared';
import { Button, Card, H2, Loading, Muted, PaymentFlow, Screen, useApiQuery, useSession, useT } from '@fixam/shared/ui';
import { useProviderMe } from '../../src/components';

export default function Subscribe() {
  const t = useT();
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { api, user } = useSession();
  const me = useProviderMe();
  const plans = useApiQuery('plans', () => api.commission.plans(), { cache: true });
  const [done, setDone] = useState(false);
  const plan = plans.data?.find((p) => p.id === planId);
  if (!plan) return <Loading />;
  return (
    <Screen footer={done ? <Button title={t('common.done')} variant="pro" onPress={() => { void me.reload(); router.back(); }} /> : undefined}>
      <Card>
        <H2>{plan.name}</H2>
        <Muted>{t('plans.fee', { amount: formatLe(plan.subscription_fee_minor), days: plan.subscription_period_days })}</Muted>
      </Card>
      <PaymentFlow
        storeKey={`pay:sub:${plan.id}`}
        amountMinor={plan.subscription_fee_minor}
        initialGateway={me.data?.payout_gateway ?? null}
        initialMsisdn={me.data?.payout_msisdn ?? user?.phone ?? ''}
        buildBody={(g, m) => ({ purpose: 'subscription', planId: plan.id, gateway: g, msisdn: g === 'wallet' ? undefined : m })}
        onSuccess={() => setDone(true)}
        successLabel={t('plans.subscribed')}
      />
    </Screen>
  );
}
