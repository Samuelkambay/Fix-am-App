import { useRouter } from 'expo-router';
import { useState } from 'react';
import { formatLe, parseLeToMinor } from '@fixam/shared';
import { Button, Card, Field, PaymentFlow, Row, Screen, Strong, useSession, useT } from '@fixam/shared/ui';

const PRESETS = [5000, 10000, 20000, 50000]; // Le 50, 100, 200, 500

export default function TopUp() {
  const t = useT();
  const router = useRouter();
  const { user } = useSession();
  const [text, setText] = useState('100');
  const [amount, setAmount] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const minor = parseLeToMinor(text);
  const valid = minor != null && minor >= 10_00 && minor <= 50_000_00;

  if (amount == null) {
    return (
      <Screen footer={<Button title={t('common.continue')} disabled={!valid} onPress={() => setAmount(minor!)} testID="topup-continue" />}>
        <Field label={t('wallet.topUpAmount')} value={text} onChangeText={setText} keyboardType="numeric" inputMode="decimal" hint={t('wallet.topUpRange')} style={{ fontSize: 28, fontWeight: '800' }} />
        <Row wrap>
          {PRESETS.map((p) => (
            <Button key={p} small title={formatLe(p)} variant={minor === p ? 'primary' : 'secondary'} onPress={() => setText(String(p / 100))} />
          ))}
        </Row>
      </Screen>
    );
  }
  return (
    <Screen footer={done ? <Button title={t('common.done')} onPress={() => router.back()} /> : undefined}>
      <Card>
        <Strong>{t('wallet.topUp')}</Strong>
      </Card>
      <PaymentFlow
        storeKey={`pay:topup:${amount}`}
        amountMinor={amount}
        initialMsisdn={user?.phone ?? ''}
        buildBody={(g, m) => ({ purpose: 'wallet_topup', amountMinor: amount, gateway: g as Exclude<typeof g, 'wallet'>, msisdn: m })}
        onSuccess={() => setDone(true)}
        successLabel={t('wallet.topUpDone')}
      />
    </Screen>
  );
}
