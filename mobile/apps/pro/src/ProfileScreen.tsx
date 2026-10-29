import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { errorMessage, formatLocalPhone, suggestedWallet, tryNormalizeSlPhone, walletMismatch, type GatewayCode } from '@fixam/shared';
import { Banner, Button, Card, Choice, Field, KV, LanguageToggle, Muted, Screen, SectionTitle, useSession, useT } from '@fixam/shared/ui';
import { API_URL } from './platform';
import { useProviderMe } from './components';

const WALLETS: GatewayCode[] = ['orange_money', 'afrimoney', 'qmoney', 'monime'];

function PayoutSettings() {
  const t = useT();
  const { api } = useSession();
  const me = useProviderMe();
  const [msisdn, setMsisdn] = useState('');
  const [gateway, setGateway] = useState<GatewayCode | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (me.data && gateway === null) {
      setMsisdn(formatLocalPhone(me.data.payout_msisdn ?? ''));
      setGateway(me.data.payout_gateway ?? suggestedWallet(me.data.payout_msisdn ?? ''));
    }
  }, [me.data, gateway]);
  const mismatch = gateway ? walletMismatch(gateway, msisdn) : null;
  return (
    <>
      <SectionTitle>{t('profile.payout')}</SectionTitle>
      <Field label={t('register.payoutNumber')} value={msisdn} onChangeText={setMsisdn} keyboardType="phone-pad" />
      {WALLETS.map((g) => (
        <Choice key={g} title={t.dyn(`method.${g}`, g)} selected={gateway === g} onPress={() => setGateway(g)} />
      ))}
      {mismatch ? <Banner tone="warn" title={t('method.useSuggested', { wallet: t.dyn(`method.${mismatch}`, mismatch) })} action={t('method.useSuggested', { wallet: t.dyn(`method.${mismatch}`, mismatch) })} onAction={() => setGateway(mismatch)} /> : null}
      <Button
        title={t('common.save')}
        variant="pro"
        disabled={!gateway || !tryNormalizeSlPhone(msisdn) || !!mismatch}
        onPress={async () => {
          setMsg(null);
          try {
            await api.providers.updateMe({ payoutGateway: gateway!, payoutMsisdn: tryNormalizeSlPhone(msisdn)! });
            await me.reload();
            setMsg({ ok: true, text: t('profile.payoutSaved') });
          } catch (e) {
            setMsg({ ok: false, text: errorMessage(e, t('common.offline')) });
          }
        }}
      />
      {msg ? <Banner tone={msg.ok ? 'success' : 'danger'} title={msg.text} /> : null}
    </>
  );
}

export function ProfileScreen() {
  const t = useT();
  const router = useRouter();
  const { api, user, updateUser, logout } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Screen>
      <Card>
        <KV k={t('profile.phone')} v={formatLocalPhone(user?.phone)} bold />
        <KV k={t('profile.role')} v={user?.role === 'provider' ? t('pro.roleProvider') : t('pro.roleServiceman')} />
      </Card>
      <Field label={t('profile.name')} value={name} onChangeText={setName} autoCapitalize="words" />
      <Button
        title={t('common.save')}
        variant="pro"
        disabled={name.trim().length < 2 || name.trim() === user?.name}
        onPress={async () => {
          try {
            updateUser(await api.auth.updateMe({ name: name.trim() }));
            setMsg(t('common.saved'));
          } catch (e) {
            setMsg(errorMessage(e, t('common.offline')));
          }
        }}
      />
      {msg ? <Muted>{msg}</Muted> : null}
      <SectionTitle>{t('common.language')}</SectionTitle>
      <LanguageToggle />
      {user?.role === 'provider' ? <PayoutSettings /> : null}
      <SectionTitle> </SectionTitle>
      <Button title={t('common.logout')} variant="danger" onPress={async () => { await logout(); router.replace('/login'); }} />
      <Muted center>
        {t('profile.apiUrl')}: {API_URL}
      </Muted>
    </Screen>
  );
}
