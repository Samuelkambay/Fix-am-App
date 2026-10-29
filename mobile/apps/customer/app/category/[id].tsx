import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { formatLe } from '@fixam/shared';
import { Banner, EmptyState, ListRow, QueryView, Screen, useApiQuery, useSession, useT, colors } from '@fixam/shared/ui';
import { unitText } from '../../src/components';
import { useDraft, useZone } from '../../src/state';

export default function CategoryScreen() {
  const t = useT();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { api } = useSession();
  const { zone } = useZone();
  const { reset } = useDraft();
  // With a zone, the API lists only services some active provider offers there.
  const q = useApiQuery(`services:${id}:${zone?.id ?? 'all'}`, () => api.catalog.services({ categoryId: id, zoneId: zone?.id }), { cache: true });

  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <Stack.Screen options={{ title: name ?? t('home.categories') }} />
      {!zone ? <Banner tone="info" title={t('zone.pick')} action={t('zone.pick')} onAction={() => router.push('/zone')} /> : null}
      <QueryView q={q}>
        {(rows) =>
          rows.length ? (
            <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
              {rows.map((s) => (
                <ListRow
                  key={s.id}
                  testID={`service-${s.id}`}
                  title={s.name}
                  subtitle={`${t('service.from', { price: formatLe(s.base_price_minor) })} ${unitText(t, s)} · ${t('service.duration', { minutes: s.duration_minutes })}`}
                  onPress={() => {
                    reset({ service: s, zone });
                    router.push(`/service/${s.id}`);
                  }}
                />
              ))}
            </View>
          ) : (
            <EmptyState icon="🧰" title={t('service.noneInZone')} action={t('zone.pick')} onAction={() => router.push('/zone')} />
          )
        }
      </QueryView>
    </Screen>
  );
}
