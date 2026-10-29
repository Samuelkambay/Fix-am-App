import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Button, Card, EmptyState, LedgerList, Money, Muted, QueryView, Screen, SectionTitle, useApiQuery, useSession, useT } from '@fixam/shared/ui';

export default function WalletScreen() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const q = useApiQuery('wallet:customer:full', () => api.wallet.customer({ limit: 100 }), { cache: true });
  useFocusEffect(
    useCallback(() => {
      void q.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <QueryView q={q}>
        {(w) => (
          <>
            <Card tone="brand" testID="wallet-balance">
              <Muted>{t('wallet.balance')}</Muted>
              <Money minor={w.balance_minor} size="hero" />
              <Button title={`＋ ${t('wallet.topUp')}`} onPress={() => router.push('/topup')} testID="topup-button" />
            </Card>
            <SectionTitle>{t('wallet.history')}</SectionTitle>
            {w.entries.length ? <LedgerList entries={w.entries} /> : <EmptyState icon="👛" title={t('wallet.empty')} />}
          </>
        )}
      </QueryView>
    </Screen>
  );
}
