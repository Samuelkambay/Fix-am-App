import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { errorMessage, formatBps, formatLe, formatLongDate, parseLeToMinor, type CommissionPreview } from '@fixam/shared';
import { Banner, Body, Button, Card, Choice, colors, Field, H2, KV, Money, Muted, Pill, QueryView, Row, Screen, SectionTitle, space, Strong, useApiQuery, useSession, useT } from '@fixam/shared/ui';
import { useProviderMe } from '../src/components';

export default function Plans() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const me = useProviderMe();
  const plans = useApiQuery('plans', () => api.commission.plans(), { cache: true });
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [peak, setPeak] = useState('0');
  const [preview, setPreview] = useState<CommissionPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = me.data?.services[0];
    if (s && !serviceId) {
      setServiceId(s.id);
      setPrice(String((s.price_override_minor ?? s.base_price_minor) / 100));
    }
  }, [me.data, serviceId]);

  const calc = async () => {
    setErr(null);
    const sub = parseLeToMinor(price);
    const sur = parseLeToMinor(peak || '0');
    if (!serviceId || sub == null || sur == null) return;
    try {
      setPreview(await api.providers.commissionPreview({ serviceId, subtotalMinor: sub, surchargeMinor: sur }));
    } catch (e) {
      setErr(errorMessage(e, t('common.offline')));
    }
  };

  return (
    <Screen onRefresh={plans.reload} refreshing={plans.refreshing}>
      <QueryView q={plans}>
        {(rows) => (
          <View style={{ gap: space.md }}>
            {me.data?.active_subscription?.ends_at ? (
              <Banner tone="success" icon="✅" title={t('plans.activeUntil', { date: formatLongDate(me.data.active_subscription.ends_at) })} />
            ) : null}
            {rows.map((p) => {
              const current = me.data?.commission_plan_id === p.id;
              const monthly = p.model !== 'commission';
              return (
                <Card key={p.id} style={current ? { borderColor: colors.pro, borderWidth: 3 } : undefined} testID={`plan-${p.code}`}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <H2>{p.name}</H2>
                      {p.name !== (monthly ? t('plans.monthly') : t('plans.payPerJob')) ? <Muted>{monthly ? t('plans.monthly') : t('plans.payPerJob')}</Muted> : null}
                    </View>
                    {current ? <Pill tone="info" label={t('plans.current')} /> : null}
                  </Row>
                  {monthly ? <Money minor={p.subscription_fee_minor} size="title" color={colors.pro} /> : <Strong color={colors.pro} style={{ fontSize: 22 }}>{t('plans.free')}</Strong>}
                  {monthly ? <Muted>{t('plans.fee', { amount: formatLe(p.subscription_fee_minor), days: p.subscription_period_days })}</Muted> : null}
                  <Body>✔ {t('plans.commission', { rate: formatBps(monthly ? p.subscription_rate_bps : p.default_rate_bps) })}</Body>
                  {p.surcharge_rate_bps != null ? <Body>✔ {t('plans.peakRate', { rate: formatBps(p.surcharge_rate_bps) })}</Body> : null}
                  {p.min_commission_minor > 0 ? <Body>✔ {t('plans.minCommission', { amount: formatLe(p.min_commission_minor) })}</Body> : null}
                  {p.tiers
                    .filter((x) => x.min_gmv_minor > 0)
                    .map((x) => (
                      <Body key={x.min_gmv_minor}>✔ {t('plans.tiers', { rate: formatBps(x.rate_bps), amount: formatLe(x.min_gmv_minor) })}</Body>
                    ))}
                  {(p.category_rates ?? []).map((c) => (
                    <Muted key={c.category_id}>{t('plans.categoryRate', { category: c.category_name, rate: formatBps(c.rate_bps) })}</Muted>
                  ))}
                  {monthly ? (
                    <Button
                      title={current && me.data?.active_subscription ? t('plans.renew') : t('plans.subscribe')}
                      variant="pro"
                      onPress={() => router.push({ pathname: '/subscribe/[planId]', params: { planId: p.id } })}
                    />
                  ) : null}
                </Card>
              );
            })}
            <Muted>{t('plans.gstNote')}</Muted>
          </View>
        )}
      </QueryView>

      <SectionTitle>{t('plans.calc')}</SectionTitle>
      <Card>
        <Strong>{t('plans.calcService')}</Strong>
        {(me.data?.services ?? []).map((s) => (
          <Choice
            key={s.id}
            title={s.name}
            subtitle={formatLe(s.price_override_minor ?? s.base_price_minor)}
            selected={serviceId === s.id}
            onPress={() => {
              setServiceId(s.id);
              setPrice(String((s.price_override_minor ?? s.base_price_minor) / 100));
              setPreview(null);
            }}
          />
        ))}
        <Field label={t('plans.calcPrice')} value={price} onChangeText={setPrice} keyboardType="numeric" />
        <Field label={t('plans.calcPeak')} value={peak} onChangeText={setPeak} keyboardType="numeric" />
        <Button title={t('plans.calcRun')} variant="pro" onPress={calc} disabled={!serviceId} testID="calc" />
        {err ? <Banner tone="danger" title={err} /> : null}
        {preview ? (
          <Card tone="success" testID="calc-result">
            <H2 color={colors.success}>{t('plans.calcKeep', { amount: formatLe(preview.providerEarningMinor) })}</H2>
            <KV k={t('common.total')} v={formatLe(preview.totalMinor)} />
            <KV k={`${t('job.commission')} (${formatBps(preview.rateBps)})`} v={`-${formatLe(preview.commissionMinor)}`} />
            <KV k={t('job.gst')} v={`-${formatLe(preview.gstMinor)}`} />
          </Card>
        ) : null}
      </Card>
    </Screen>
  );
}
