import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { errorMessage, formatLe, parseBlocker, type Blocker } from '@fixam/shared';
import { Banner, Body, Card, colors, H2, Muted, Pill, QueryView, Row, Screen, SectionTitle, space, Toggle, useApiQuery, useSession, useT, Button } from '@fixam/shared/ui';
import { Stat, useProviderMe } from '../../src/components';

export default function Dashboard() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const me = useProviderMe();
  const requests = useApiQuery('jobs:requests', () => api.bookings.list({ scope: 'requests' }), { cache: true });
  const [err, setErr] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      void me.reload();
      void requests.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const explain = (b: Blocker, owed: number, limit: number) => {
    switch (b.kind) {
      case 'missing_badge':
        return { title: t('blocker.missing_badge', { badge: t.dyn(`badge.${b.badge}`, b.badge) }), body: t('blocker.missing_badgeBody'), action: t('blocker.missing_badgeCta'), go: () => router.push('/badges') };
      case 'cash_limit':
        return { title: t('blocker.cash'), body: t('blocker.cashBody', { owed: formatLe(owed), limit: formatLe(limit) }), action: t('blocker.cashCta'), go: () => router.push('/pay-commission') };
      case 'pending':
        return { title: t('blocker.pending'), body: t('blocker.pendingBody') };
      case 'suspended':
        return { title: t('blocker.suspended'), body: t('blocker.suspendedBody') };
      default:
        return { title: t('blocker.other'), body: b.raw };
    }
  };

  return (
    <Screen onRefresh={() => { void me.reload(); void requests.reload(); }} refreshing={me.refreshing}>
      <QueryView q={me}>
        {(p) => (
          <View style={{ gap: space.md }}>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <H2 style={{ flex: 1 }}>{p.business_name}</H2>
                <Pill tone={p.status === 'active' ? 'success' : p.status === 'pending' ? 'warn' : 'danger'} label={t.dyn(`provStatus.${p.status}`, p.status)} />
              </Row>
              <Muted>{t('dash.plan', { plan: p.commission_plan?.name ?? '—' })}</Muted>
            </Card>

            {p.status === 'pending' ? <Banner tone="warn" icon="⏳" title={t('dash.pending')} body={t('dash.pendingBody')} action={t('blocker.missing_badgeCta')} onAction={() => router.push('/badges')} testID="pending-banner" /> : null}
            {p.status === 'suspended' ? <Banner tone="danger" title={t('dash.suspended')} body={t('dash.suspendedBody')} /> : null}

            <Toggle
              label={t('dash.available')}
              hint={p.is_available ? t('dash.availableOn') : t('dash.availableOff')}
              value={p.is_available}
              onChange={async (v) => {
                setErr(null);
                me.setData({ ...p, is_available: v });
                try {
                  await api.providers.updateMe({ isAvailable: v });
                } catch (e) {
                  me.setData({ ...p, is_available: !v });
                  setErr(errorMessage(e, t('common.offline')));
                }
              }}
            />
            {err ? <Banner tone="danger" title={err} /> : null}

            {p.can_accept_jobs ? (
              <Banner tone="success" icon="✅" title={t('dash.canAccept')} />
            ) : (
              <Card tone="danger" testID="blockers">
                <H2 color={colors.danger}>🚫 {t('dash.cannotAccept')}</H2>
                {p.accept_blockers.map((raw) => {
                  const e = explain(parseBlocker(raw), p.commission_owed_minor, p.cash_commission_limit_minor);
                  return (
                    <View key={raw} style={{ backgroundColor: colors.card, borderRadius: 12, padding: space.md, gap: space.xs }}>
                      <Body style={{ fontWeight: '800' }}>{e.title}</Body>
                      <Body>{e.body}</Body>
                      {e.action && e.go ? <Button title={e.action} variant="pro" small onPress={e.go} /> : null}
                    </View>
                  );
                })}
              </Card>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Stat label={t('dash.balance')} value={formatLe(p.balance_minor)} tone={p.balance_minor < 0 ? 'danger' : 'success'} />
              <Stat label={t('dash.owed')} value={formatLe(p.commission_owed_minor)} tone={p.commission_owed_minor > 0 ? 'danger' : undefined} />
              <Stat label={t('dash.jobsDone')} value={String(p.completed_jobs)} />
              <Stat label={t('dash.rating')} value={p.rating_count ? `★ ${Number(p.rating_avg).toFixed(1)} (${p.rating_count})` : '—'} />
              <Stat label={t('dash.trust')} value={String(p.trust_score)} />
              <Stat label={t('dash.requests')} value={String(requests.data?.length ?? '…')} />
            </View>
            {p.commission_owed_minor > 0 && p.can_accept_jobs ? (
              <Banner tone="warn" title={t('earn.payOwedHint', { limit: formatLe(p.cash_commission_limit_minor) })} action={t('earn.payOwed')} onAction={() => router.push('/pay-commission')} />
            ) : null}

            <SectionTitle>{t('dash.requests')}</SectionTitle>
            <Button title={`${t('dash.seeRequests')} (${requests.data?.length ?? 0})`} variant="pro" onPress={() => router.push('/(provider)/jobs')} />
          </View>
        )}
      </QueryView>
    </Screen>
  );
}
