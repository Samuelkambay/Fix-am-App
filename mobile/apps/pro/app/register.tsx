import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { errorMessage, formatLe, formatLocalPhone, suggestedWallet, tryNormalizeSlPhone, walletMismatch, type GatewayCode } from '@fixam/shared';
import {
  Banner, Body, Button, Check, Choice, Field, H2, Loading, Muted, QueryView, Screen, SectionTitle, Segmented, space, useApiQuery,
  useSession, useT,
} from '@fixam/shared/ui';

const WALLETS: GatewayCode[] = ['orange_money', 'afrimoney', 'qmoney', 'monime'];

/** A logged-in customer account becomes a provider (pending until FixAm approves). */
export default function Register() {
  const t = useT();
  const router = useRouter();
  const { api, user, refreshUser, logout } = useSession();
  const zones = useApiQuery('zones', () => api.zones.list(), { cache: true });
  const services = useApiQuery('services:all', () => api.catalog.services(), { cache: true });
  const [businessName, setBusinessName] = useState(user?.name ?? '');
  const [kind, setKind] = useState<'individual' | 'company'>('individual');
  const [bio, setBio] = useState('');
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [msisdn, setMsisdn] = useState(formatLocalPhone(user?.phone ?? ''));
  const [gateway, setGateway] = useState<GatewayCode>(suggestedWallet(user?.phone ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const byCategory = useMemo(() => {
    const m = new Map<string, NonNullable<typeof services.data>>();
    for (const s of services.data ?? []) m.set(s.category_name ?? '', [...(m.get(s.category_name ?? '') ?? []), s]);
    return [...m.entries()];
  }, [services.data]);

  if (!user) return <Loading />;
  const mismatch = walletMismatch(gateway, msisdn);
  const valid = businessName.trim().length >= 2 && zoneIds.length > 0 && serviceIds.length > 0 && !!tryNormalizeSlPhone(msisdn) && !mismatch;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!valid) return;
    try {
      await api.providers.register({
        businessName: businessName.trim(),
        kind,
        bio: bio.trim() || undefined,
        zoneIds,
        services: serviceIds.map((serviceId) => ({ serviceId })),
        payoutGateway: gateway,
        payoutMsisdn: tryNormalizeSlPhone(msisdn)!,
      });
      await refreshUser(); // role is now 'provider'
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e, t('common.offline')));
    }
  };

  return (
    <Screen footer={<Button title={t('register.submit')} variant="pro" onPress={submit} />}>
      <Banner tone="info" title={t('pro.customerAccount')} />
      <H2>{t('register.title')}</H2>
      <Body>{t('register.intro')}</Body>
      <Field label={t('register.businessName')} value={businessName} onChangeText={setBusinessName} error={touched && businessName.trim().length < 2 ? t('register.needName') : null} />
      <SectionTitle>{t('register.kind')}</SectionTitle>
      <Segmented tone="pro" value={kind} onChange={setKind} options={[{ value: 'individual', label: t('register.individual') }, { value: 'company', label: t('register.company') }]} />
      <Field label={t('register.bio')} optional optionalText={t('common.optional')} value={bio} onChangeText={setBio} multiline />

      <SectionTitle>{t('register.zones')}</SectionTitle>
      {touched && !zoneIds.length ? <Banner tone="danger" title={t('register.needZone')} /> : null}
      <QueryView q={zones}>
        {(rows) => (
          <View style={{ gap: space.sm }}>
            {rows.map((z) => (
              <Check key={z.id} title={z.name} subtitle={z.district} checked={zoneIds.includes(z.id)} onPress={() => toggle(zoneIds, setZoneIds, z.id)} />
            ))}
          </View>
        )}
      </QueryView>

      <SectionTitle>{t('register.services')}</SectionTitle>
      {touched && !serviceIds.length ? <Banner tone="danger" title={t('register.needService')} /> : null}
      <QueryView q={services}>
        {() => (
          <View style={{ gap: space.sm }}>
            {byCategory.map(([cat, list]) => (
              <View key={cat} style={{ gap: space.sm }}>
                <Muted>{cat}</Muted>
                {list.map((s) => (
                  <Check key={s.id} title={s.name} subtitle={formatLe(s.base_price_minor)} checked={serviceIds.includes(s.id)} onPress={() => toggle(serviceIds, setServiceIds, s.id)} />
                ))}
              </View>
            ))}
          </View>
        )}
      </QueryView>

      <SectionTitle>{t('register.payout')}</SectionTitle>
      <Field label={t('register.payoutNumber')} value={msisdn} onChangeText={(v) => { setMsisdn(v); if (tryNormalizeSlPhone(v)) setGateway(suggestedWallet(v)); }} keyboardType="phone-pad" />
      {WALLETS.map((g) => (
        <Choice key={g} title={t.dyn(`method.${g}`, g)} selected={gateway === g} onPress={() => setGateway(g)} />
      ))}
      {mismatch ? <Banner tone="warn" title={t('method.useSuggested', { wallet: t.dyn(`method.${mismatch}`, mismatch) })} action={t('method.useSuggested', { wallet: t.dyn(`method.${mismatch}`, mismatch) })} onAction={() => setGateway(mismatch)} /> : null}
      {error ? <Banner tone="danger" title={error} /> : null}
      <Button title={t('common.logout')} variant="ghost" onPress={async () => { await logout(); router.replace('/login'); }} />
    </Screen>
  );
}
