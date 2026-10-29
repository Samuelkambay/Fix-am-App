import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { isActiveBooking } from '@fixam/shared';
import { Banner, EmptyState, QueryView, Screen, SectionTitle, space, useApiQuery, useSession, useT } from '@fixam/shared/ui';
import { JobCard } from '../../src/components';

export default function ServicemanJobs() {
  const t = useT();
  const router = useRouter();
  const { api, user } = useSession();
  const q = useApiQuery('jobs:serviceman', () => api.bookings.list({ scope: 'serviceman', limit: 100 }), { cache: true, pollMs: 30_000 });
  useFocusEffect(
    useCallback(() => {
      void q.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <Banner tone="info" icon="👷" title={`${t('sman.worksFor')}: ${user?.name ?? ''}`} />
      <QueryView q={q}>
        {(rows) => {
          if (!rows.length) return <EmptyState icon="🧰" title={t('sman.empty')} />;
          const active = rows.filter(isActiveBooking);
          const past = rows.filter((r) => !isActiveBooking(r));
          return (
            <View style={{ gap: space.md }}>
              {active.map((j) => (
                <JobCard key={j.id} job={j} onPress={() => router.push(`/job/${j.id}`)} />
              ))}
              {past.length ? <SectionTitle>{t('bookings.past')}</SectionTitle> : null}
              {past.map((j) => (
                <JobCard key={j.id} job={j} onPress={() => router.push(`/job/${j.id}`)} />
              ))}
            </View>
          );
        }}
      </QueryView>
    </Screen>
  );
}
