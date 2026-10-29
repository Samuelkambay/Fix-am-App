import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { formatDateTime, formatLe, isActiveBooking, statusTone } from '@fixam/shared';
import { Card, EmptyState, Muted, Pill, QueryView, Row, Screen, Segmented, space, Strong, useApiQuery, useSession, useT } from '@fixam/shared/ui';

export default function Bookings() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const q = useApiQuery('bookings:customer', () => api.bookings.list({ scope: 'customer', limit: 100 }), { cache: true });
  useFocusEffect(
    useCallback(() => {
      void q.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: t('bookings.active') },
          { value: 'past', label: t('bookings.past') },
        ]}
      />
      <QueryView q={q}>
        {(rows) => {
          const list = rows.filter((b) => (tab === 'active' ? isActiveBooking(b) : !isActiveBooking(b)));
          if (!list.length) return <EmptyState icon="📋" title={t('bookings.empty')} action={t('home.categories')} onAction={() => router.push('/(tabs)')} />;
          return (
            <View style={{ gap: space.md }}>
              {list.map((b) => (
                <Card key={b.id} onPress={() => router.push(`/booking/${b.id}`)} testID={`booking-${b.code}`}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Pill tone={statusTone(b.status)} label={t.dyn(`status.${b.status}`, b.status)} />
                    <Strong>{formatLe(b.total_minor)}</Strong>
                  </Row>
                  <Strong style={{ fontSize: 19 }}>{b.service_name}</Strong>
                  <Muted>
                    {b.is_emergency ? `⚡ ${t('book.asap')}` : formatDateTime(b.scheduled_at)} · {b.area}
                  </Muted>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Muted>{b.provider_name ?? t('status.pending')}</Muted>
                    <Muted>{t.dyn(`payStatus.${b.payment_status}`, b.payment_status)}</Muted>
                  </Row>
                </Card>
              ))}
            </View>
          );
        }}
      </QueryView>
    </Screen>
  );
}
