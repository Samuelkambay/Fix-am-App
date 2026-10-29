import { useRouter } from 'expo-router';
import { useState } from 'react';
import { errorMessage, formatLe, formatLocalPhone, parseLeToMinor } from '@fixam/shared';
import { Banner, Button, Card, Field, Loading, Money, Muted, QueryView, Screen, useApiQuery, useSession, useT, colors } from '@fixam/shared/ui';
import { useProviderMe } from '../src/components';

export default function Withdraw() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const me = useProviderMe();
  const wallet = useApiQuery('wallet:provider', () => api.wallet.provider({ limit: 1 }));
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!me.data) return <Loading />;
  const p = me.data;
  return (
    <Screen>
      <QueryView q={wallet}>
        {(w) => {
          const minor = parseLeToMinor(text);
          const max = w.available_minor - w.payout_fee_minor;
          const ok = minor != null && minor >= w.payout_min_minor && minor <= max;
          return (
            <>
              <Card>
                <Muted>{t('earn.available')}</Muted>
                <Money minor={w.available_minor} size="hero" color={colors.pro} />
                {p.payout_gateway && p.payout_msisdn ? (
                  <Muted>{t('earn.withdrawTo', { wallet: t.dyn(`method.${p.payout_gateway}`, p.payout_gateway), number: formatLocalPhone(p.payout_msisdn) })}</Muted>
                ) : (
                  <Banner tone="warn" title={t('earn.noPayout')} action={t('profile.title')} onAction={() => router.push('/profile')} />
                )}
              </Card>
              <Field label={`${t('common.amount')} (Le)`} value={text} onChangeText={setText} keyboardType="numeric" hint={`${t('earn.min', { amount: formatLe(w.payout_min_minor) })} · ${t('earn.fee', { amount: formatLe(w.payout_fee_minor) })}`} style={{ fontSize: 26, fontWeight: '800' }} />
              <Button title={t('earn.withdraw')} variant="pro" disabled={!ok || !p.payout_msisdn} onPress={async () => {
                setMsg(null);
                try {
                  await api.wallet.requestPayout(minor!);
                  setMsg({ ok: true, text: t('earn.requested') });
                  setText('');
                  await wallet.reload();
                } catch (e) {
                  setMsg({ ok: false, text: errorMessage(e, t('common.offline')) });
                }
              }} />
              {msg ? <Banner tone={msg.ok ? 'success' : 'danger'} title={msg.text} /> : null}
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
