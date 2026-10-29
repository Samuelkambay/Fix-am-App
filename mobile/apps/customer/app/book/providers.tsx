import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Banner, Button, EmptyState, QueryView, Screen, space, useApiQuery, useSession, useT } from '@fixam/shared/ui';
import { ProviderCard } from '../../src/components';
import { useDraft } from '../../src/state';

/** Optional: book a specific fixer. Ranked by availability, trust badges, then rating (server side). */
export default function ChooseProvider() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const { draft, update } = useDraft();
  const key = draft.service && draft.zone ? `providers:${draft.zone.id}:${draft.service.id}` : null;
  const q = useApiQuery(key, () => api.providers.search({ zoneId: draft.zone!.id, serviceId: draft.service!.id }), { cache: true });

  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      {!key ? <Banner tone="info" title={t('zone.pick')} /> : null}
      <Button
        title={`${!draft.provider ? '✓ ' : ''}${t('book.anyProvider')}`}
        variant={!draft.provider ? 'primary' : 'secondary'}
        onPress={() => {
          update({ provider: null });
          router.back();
        }}
      />
      <QueryView q={q}>
        {(rows) =>
          rows.length ? (
            <View style={{ gap: space.md }}>
              {rows.map((p) => (
                <ProviderCard
                  key={p.id}
                  p={p}
                  chosen={draft.provider?.id === p.id}
                  basePriceMinor={draft.service?.base_price_minor}
                  onPress={() => router.push(`/provider/${p.id}`)}
                  onChoose={() => {
                    update({ provider: p });
                    router.back();
                  }}
                />
              ))}
            </View>
          ) : (
            <EmptyState icon="🔎" title={t('providers.none')} />
          )
        }
      </QueryView>
    </Screen>
  );
}
