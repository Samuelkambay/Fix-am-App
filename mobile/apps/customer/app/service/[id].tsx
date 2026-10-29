import { Stack as RouterStack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { errorMessage, formatDay, formatLe, freetownDate, summariseCurve } from '@fixam/shared';
import {
  Banner, Body, Button, Card, colors, H2, ListRow, Loading, Muted, QueryView, Row, Screen, SectionTitle, space,
  Strong, Toggle, useApiQuery, useSession, useT,
} from '@fixam/shared/ui';
import { PriceStrip, QuoteCard, unitText } from '../../src/components';
import { quoteDraft, useDraft, useZone } from '../../src/state';

export default function ServiceScreen() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { zone } = useZone();
  const { draft, update } = useDraft();
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const svcQ = useApiQuery(draft.service?.id === id ? null : `service:${id}`, () => api.catalog.service(id), { cache: true });
  const service = draft.service?.id === id ? draft.service : svcQ.data;
  useEffect(() => {
    if (svcQ.data && draft.service?.id !== id) update({ service: svcQ.data, zone });
  }, [svcQ.data, draft.service?.id, id, update, zone]);
  useEffect(() => {
    if (zone && draft.zone?.id !== zone.id) update({ zone });
    if (!draft.date) update({ date: freetownDate(0) });
  }, [zone, draft.zone?.id, draft.date, update]);

  const date = draft.date || freetownDate(0);
  const curve = useApiQuery(
    service && zone && !draft.isEmergency ? `curve:${service.id}:${zone.id}:${date}:${draft.provider?.id ?? ''}` : null,
    () => api.pricing.dayCurve({ serviceId: service!.id, zoneId: zone!.id, date, providerId: draft.provider?.id }),
  );

  // Pre-select the cheapest bookable hour, so the default choice is the one that saves money.
  useEffect(() => {
    if (!curve.data || draft.isEmergency) return;
    const s = summariseCurve(curve.data.hours);
    if (!draft.scheduledAt || !s.hours.some((h) => h.at === draft.scheduledAt)) update({ scheduledAt: s.cheapest?.at ?? null });
  }, [curve.data, draft.isEmergency, draft.scheduledAt, update]);

  if (!service) return <Screen>{svcQ.error ? <Banner tone="danger" title={errorMessage(svcQ.error)} /> : <Loading />}</Screen>;
  if (!zone) {
    return (
      <Screen>
        <Banner tone="info" title={t('zone.pick')} action={t('zone.pick')} onAction={() => router.push('/zone')} />
      </Screen>
    );
  }

  const variable = service.price_unit !== 'fixed';
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => freetownDate(i));
  const canQuote = draft.isEmergency || !!draft.scheduledAt;

  const getQuote = async () => {
    setQuoteError(null);
    setQuoting(true);
    try {
      update({ quote: await quoteDraft({ ...draft, service, zone }) });
    } catch (e) {
      setQuoteError(errorMessage(e, t('common.offline')));
    } finally {
      setQuoting(false);
    }
  };

  const quoteOk = draft.quote && new Date(draft.quote.expires_at).getTime() > Date.now();

  return (
    <Screen
      footer={
        draft.quote ? (
          <Button title={t('common.continue')} onPress={() => router.push('/book/address')} disabled={!quoteOk} testID="continue-address" />
        ) : (
          <Button title={t('book.seePrice')} onPress={getQuote} loading={quoting} disabled={!canQuote} testID="see-price" />
        )
      }
    >
      <RouterStack.Screen options={{ title: service.name }} />
      <Card>
        <H2>{service.name}</H2>
        <Body>
          {t('service.from', { price: formatLe(service.base_price_minor) })} {unitText(t, service)} · {t('service.duration', { minutes: service.duration_minutes })}
        </Body>
        {service.description ? <Muted>{service.description}</Muted> : null}
        <Muted>📍 {zone.name}</Muted>
      </Card>

      <Toggle label={`⚡ ${t('book.urgent')}`} hint={t('book.urgentHint')} value={draft.isEmergency} onChange={(v) => update({ isEmergency: v })} />

      {variable ? (
        <Card>
          <Strong>{service.price_unit === 'hourly' ? t('book.hours') : t('book.quantity', { unit: service.unit_label ?? '' })}</Strong>
          <Row style={{ justifyContent: 'center' }} gap={space.lg}>
            <Button title="−" small variant="secondary" onPress={() => update({ quantity: Math.max(1, draft.quantity - 1) })} style={{ width: 64 }} />
            <H2>{draft.quantity}</H2>
            <Button title="+" small variant="secondary" onPress={() => update({ quantity: Math.min(100, draft.quantity + 1) })} style={{ width: 64 }} />
          </Row>
        </Card>
      ) : null}

      {!draft.isEmergency ? (
        <>
          <SectionTitle>{t('book.chooseTime')}</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {days.map((d, i) => (
              <Button
                key={d}
                small
                testID={`day-${i}`}
                title={i === 0 ? t('common.today') : i === 1 ? t('common.tomorrow') : formatDay(`${d}T12:00:00Z`)}
                variant={d === date ? 'primary' : 'secondary'}
                onPress={() => update({ date: d, scheduledAt: null })}
              />
            ))}
          </ScrollView>
          <SectionTitle>{t('book.priceByHour')}</SectionTitle>
          <QueryView q={curve}>
            {(c) => <PriceStrip hours={c.hours} selectedAt={draft.scheduledAt} onSelect={(h) => update({ scheduledAt: h.at })} />}
          </QueryView>
        </>
      ) : null}

      <SectionTitle>{t('book.chooseProvider')}</SectionTitle>
      <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
        <ListRow
          testID="choose-provider"
          title={draft.provider ? t('book.provider', { name: draft.provider.business_name }) : t('book.anyProvider')}
          subtitle={draft.provider ? undefined : t('providers.title')}
          onPress={() => router.push('/book/providers')}
        />
      </View>

      {quoteError ? <Banner tone="danger" title={quoteError} /> : null}
      {draft.quote ? <QuoteCard quote={draft.quote} onRequote={getQuote} /> : null}
    </Screen>
  );
}
