import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { formatDateTime, formatLe } from '@fixam/shared';
import { Banner, Button, Card, EmptyState, KV, LedgerList, Money, Muted, Pill, QueryView, Row, Screen, SectionTitle, space, useApiQuery, useSession, useT, colors } from '@fixam/shared/ui';

export default function Earnings() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const q = useApiQuery('wallet:provider', () => api.wallet.provider({ limit: 100 }), { cache: true });
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
          <View style={{ gap: space.md }}>
            <Card style={{ backgroundColor: colors.proSoft, borderColor: colors.proSoft }} testID="earnings-card">
              <Muted>{t('earn.available')}</Muted>
              <Money minor={w.available_minor} size="hero" color={colors.pro} />
              <Muted>
                {t('earn.min', { amount: formatLe(w.payout_min_minor) })} · {t('earn.fee', { amount: formatLe(w.payout_fee_minor) })}
              </Muted>
              <Button title={t('earn.withdraw')} variant="pro" disabled={w.available_minor < w.payout_min_minor + w.payout_fee_minor} onPress={() => router.push('/withdraw')} />
            </Card>
            {w.commission_owed_minor > 0 ? (
              <Card tone="danger">
                <Muted>{t('earn.owed')}</Muted>
                <Money minor={w.commission_owed_minor} size="title" color={colors.danger} />
                <Muted>{t('earn.payOwedHint', { limit: formatLe(w.cash_commission_limit_minor) })}</Muted>
                <Button title={t('earn.payOwed')} variant="danger" onPress={() => router.push('/pay-commission')} />
              </Card>
            ) : null}
            {w.pending_payouts.length ? (
              <>
                <SectionTitle>{t('earn.pending')}</SectionTitle>
                <Card>
                  {w.pending_payouts.map((p) => (
                    <Row key={p.id} style={{ justifyContent: 'space-between' }}>
                      <KV k={formatDateTime(p.created_at)} v={formatLe(p.amount_minor)} />
                      <Pill tone="info" label={t.dyn(`earn.payoutStatus.${p.status}`, p.status)} />
                    </Row>
                  ))}
                </Card>
              </>
            ) : null}
            <SectionTitle>{t('earn.history')}</SectionTitle>
            {w.entries.length ? <LedgerList entries={w.entries} /> : <EmptyState icon="💵" title={t('wallet.empty')} />}
            <Banner tone="info" title={t('plans.calc')} action={t('plans.title')} onAction={() => router.push('/plans')} />
          </View>
        )}
      </QueryView>
    </Screen>
  );
}
