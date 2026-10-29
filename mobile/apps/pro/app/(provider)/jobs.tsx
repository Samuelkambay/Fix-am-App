import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorMessage, isActiveBooking, parseBlocker } from '@fixam/shared';
import { Banner, EmptyState, QueryView, Screen, Segmented, space, useApiQuery, useSession, useT } from '@fixam/shared/ui';
import { JobCard } from '../../src/components';

export default function Jobs() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const [tab, setTab] = useState<'requests' | 'mine'>('requests');
  const requests = useApiQuery('jobs:requests', () => api.bookings.list({ scope: 'requests' }), { cache: true, pollMs: 30_000 });
  const mine = useApiQuery('jobs:mine', () => api.bookings.list({ scope: 'provider', limit: 100 }), { cache: true });
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success' | 'warn'; text: string; badges?: boolean } | null>(null);
  useFocusEffect(
    useCallback(() => {
      void requests.reload();
      void mine.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const accept = async (id: string) => {
    setMsg(null);
    try {
      await api.bookings.accept(id);
      setMsg({ tone: 'success', text: t('jobs.accepted') });
      await Promise.all([requests.reload(), mine.reload()]);
      router.push(`/job/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_taken') {
        setMsg({ tone: 'warn', text: t('jobs.taken') });
        await requests.reload();
        return;
      }
      if (e instanceof ApiError && e.code === 'cannot_accept') {
        const blockers = ((e.details as { blockers?: string[] })?.blockers ?? []).map(parseBlocker);
        setMsg({ tone: 'danger', text: `${t('dash.cannotAccept')}: ${blockers.map((b) => (b.kind === 'missing_badge' ? t('blocker.missing_badge', { badge: t.dyn(`badge.${b.badge}`, b.badge) }) : b.kind === 'cash_limit' ? t('blocker.cash') : t('blocker.pending'))).join(', ')}`, badges: true });
        return;
      }
      setMsg({ tone: 'danger', text: errorMessage(e, t('common.offline')) });
    }
  };

  const q = tab === 'requests' ? requests : mine;
  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <Segmented
        tone="pro"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'requests', label: `${t('jobs.requests')}${requests.data ? ` (${requests.data.length})` : ''}` },
          { value: 'mine', label: t('jobs.mine') },
        ]}
      />
      {msg ? <Banner tone={msg.tone} title={msg.text} action={msg.badges ? t('dash.title') : undefined} onAction={() => router.push('/(provider)')} /> : null}
      <QueryView q={q}>
        {(rows) => {
          const list = tab === 'mine' ? [...rows].sort((a, b) => Number(isActiveBooking(b)) - Number(isActiveBooking(a))) : rows;
          if (!list.length) return <EmptyState icon="🧰" title={tab === 'requests' ? t('jobs.emptyRequests') : t('jobs.emptyMine')} />;
          return (
            <View style={{ gap: space.md }}>
              {list.map((j) => (
                <JobCard key={j.id} job={j} onPress={() => router.push(`/job/${j.id}`)} onAccept={tab === 'requests' ? () => accept(j.id) : undefined} />
              ))}
            </View>
          );
        }}
      </QueryView>
    </Screen>
  );
}
