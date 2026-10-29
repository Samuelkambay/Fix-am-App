import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatLe } from '@fixam/shared';
import {
  Banner, Body, Card, colors, EmptyState, Field, H2, ListRow, Loading, Muted, QueryView, Row, Screen, SectionTitle, space, Strong,
  useApiQuery, useSession, useT,
} from '@fixam/shared/ui';
import { categoryIcon, ProviderCard, unitText } from '../../src/components';
import { useDraft, useZone } from '../../src/state';

export default function Home() {
  const t = useT();
  const router = useRouter();
  const { api, user } = useSession();
  const { zone, status, loaded, detect } = useZone();
  const { reset } = useDraft();
  const [q, setQ] = useState('');

  // First launch: try GPS once; the user can always pick an area by hand.
  useEffect(() => {
    if (loaded && !zone && status === 'idle') void detect();
  }, [loaded, zone, status, detect]);

  const cats = useApiQuery('categories', () => api.catalog.categories(), { cache: true });
  const search = useApiQuery(q.trim().length >= 2 ? `search:${zone?.id}:${q.trim()}` : null, () => api.catalog.services({ q: q.trim(), zoneId: zone?.id }));
  const providers = useApiQuery(zone ? `verified:${zone.id}` : null, () => api.providers.search({ zoneId: zone!.id, badge: 'NATIONAL_ID', limit: 5 }), { cache: true });

  const refresh = () => {
    void cats.reload();
    void providers.reload();
  };

  return (
    <Screen onRefresh={refresh} refreshing={cats.refreshing}>
      <H2>{user?.name ? t('home.hello', { name: user.name.split(' ')[0] }) : t('home.helloAnon')}</H2>

      <Card onPress={() => router.push('/zone')} testID="zone-card">
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Muted>📍 {t('zone.current')}</Muted>
            <Strong style={{ fontSize: 20 }}>{zone ? zone.name : status === 'detecting' ? t('zone.detecting') : t('zone.pick')}</Strong>
          </View>
          <Text style={styles.change}>{t('common.change')} ›</Text>
        </Row>
      </Card>
      {status === 'outside' ? <Banner tone="warn" title={t('zone.outside')} action={t('zone.pick')} onAction={() => router.push('/zone')} /> : null}
      {status === 'denied' && !zone ? <Banner tone="info" title={t('zone.gpsDenied')} action={t('zone.pick')} onAction={() => router.push('/zone')} /> : null}

      <Field label={t('home.what')} value={q} onChangeText={setQ} placeholder={t('home.searchPlaceholder')} returnKeyType="search" testID="search-input" />

      {q.trim().length >= 2 ? (
        <QueryView q={search}>
          {(rows) =>
            rows.length ? (
              <View style={styles.list}>
                {rows.map((s) => (
                  <ListRow
                    key={s.id}
                    title={s.name}
                    subtitle={`${s.category_name ?? ''} · ${t('service.from', { price: formatLe(s.base_price_minor) })} ${unitText(t, s)}`}
                    onPress={() => {
                      reset({ service: s, zone });
                      router.push(`/service/${s.id}`);
                    }}
                  />
                ))}
              </View>
            ) : (
              <EmptyState icon="🔍" title={t('home.noResults', { q: q.trim() })} />
            )
          }
        </QueryView>
      ) : (
        <>
          <SectionTitle>{t('home.categories')}</SectionTitle>
          <QueryView q={cats}>
            {(rows) => (
              <View style={styles.grid}>
                {rows.map((c) => (
                  <Pressable
                    key={c.id}
                    testID={`cat-${c.slug}`}
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/category/[id]', params: { id: c.id, name: c.name } })}
                    style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={styles.tileIcon}>{categoryIcon(c.icon)}</Text>
                    <Text style={styles.tileText} numberOfLines={2}>
                      {t.lang === 'kri' && c.name_kri ? c.name_kri : c.name}
                    </Text>
                    <Muted>{t('home.serviceCount', { count: c.service_count })}</Muted>
                  </Pressable>
                ))}
              </View>
            )}
          </QueryView>

          <Card tone="brand" onPress={() => router.push('/(tabs)/verify')}>
            <Strong color={colors.brandDark}>🛡️ {t('home.verifyCta')} ›</Strong>
          </Card>

          <SectionTitle>{t('home.verifiedNear')}</SectionTitle>
          {!zone ? null : providers.loading && !providers.data ? (
            <Loading />
          ) : (
            <QueryView q={providers}>
              {(rows) =>
                rows.length ? (
                  <View style={{ gap: space.md }}>
                    {rows.map((p) => (
                      <ProviderCard key={p.id} p={p} onPress={() => router.push(`/provider/${p.id}`)} />
                    ))}
                  </View>
                ) : (
                  <Body>{t('home.noProviders')}</Body>
                )
              }
            </QueryView>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  change: { color: colors.brandDark, fontWeight: '800', fontSize: 17 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { width: '47.5%', minHeight: 120, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 4, justifyContent: 'center' },
  tileIcon: { fontSize: 34 },
  tileText: { fontSize: 17, fontWeight: '800', color: colors.text },
  list: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
});
