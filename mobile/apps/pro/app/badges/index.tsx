import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { formatLongDate, sortBadges, type BadgeDefinition, type ProviderBadge } from '@fixam/shared';
import { BadgeChips, badgeIcon, Body, Button, Card, colors, Muted, Pill, QueryView, Row, Screen, SectionTitle, space, Strong, useApiQuery, useSession, useT } from '@fixam/shared/ui';
import { useProviderMe } from '../../src/components';

const STATUS_TONE = { approved: 'success', pending: 'warn', rejected: 'danger', expired: 'neutral', revoked: 'danger' } as const;

/** Latest application per badge code (the API returns history, newest first within a code). */
function latestByCode(mine: ProviderBadge[]): Map<string, ProviderBadge> {
  const m = new Map<string, ProviderBadge>();
  for (const b of mine) {
    const cur = m.get(b.badge_code);
    if (!cur || (cur.status !== 'approved' && (b.status === 'approved' || b.created_at > cur.created_at))) m.set(b.badge_code, b);
  }
  return m;
}

export default function Badges() {
  const t = useT();
  const router = useRouter();
  const { api, user } = useSession();
  const me = useProviderMe();
  const defs = useApiQuery('badges:defs', () => api.badges.definitions(), { cache: true });
  const mine = useApiQuery('badges:mine', () => api.badges.mine(), { cache: true });
  useFocusEffect(
    useCallback(() => {
      void mine.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <Screen onRefresh={mine.reload} refreshing={mine.refreshing}>
      <QueryView q={mine}>
        {(rows) => {
          const latest = latestByCode(rows);
          const approved = rows.filter((b) => b.status === 'approved');
          // The card code customers check: the ID badge if held, otherwise the strongest approved badge.
          const cardBadge = approved.find((b) => b.badge_code === 'NATIONAL_ID') ?? sortBadges(approved.map((b) => b.badge_code)).map((c) => approved.find((b) => b.badge_code === c)!)[0];
          const required = me.data?.accept_blockers.filter((x) => x.startsWith('missing_badge:')).map((x) => x.slice(14)) ?? [];
          const list = (defs.data ?? []) as BadgeDefinition[];
          return (
            <View style={{ gap: space.md }}>
              <SectionTitle>{t('badges.myCard')}</SectionTitle>
              {cardBadge ? (
                <View style={{ backgroundColor: colors.pro, borderRadius: 20, padding: space.lg, gap: space.md }} testID="badge-card">
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.white, fontWeight: '900', fontSize: 20 }}>FixAm Pro</Text>
                    <Text style={{ color: '#BFD3EA', fontWeight: '700' }}>{badgeIcon(cardBadge.badge_code)} {t.dyn(`badge.${cardBadge.badge_code}`, cardBadge.name)}</Text>
                  </Row>
                  <Row gap={space.lg} style={{ alignItems: 'center' }}>
                    <View style={{ backgroundColor: colors.white, padding: 8, borderRadius: 10 }}>
                      <QRCode value={cardBadge.verification_code} size={112} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: colors.white, fontSize: 20, fontWeight: '800' }}>{me.data?.business_name}</Text>
                      <Text style={{ color: '#DCE7F4', fontSize: 16 }}>{user?.name}</Text>
                      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={{ color: colors.white, fontSize: 22, fontWeight: '900' }}>{cardBadge.verification_code}</Text>
                    </View>
                  </Row>
                  <BadgeChips codes={approved.map((b) => b.badge_code)} />
                  <Text style={{ color: '#DCE7F4', fontSize: 15 }}>{t('badges.myCardHint')}</Text>
                </View>
              ) : (
                <Card tone="warn">
                  <Body>{t('blocker.missing_badgeBody')}</Body>
                </Card>
              )}

              <SectionTitle>{t('badges.verification')}</SectionTitle>
              {list
                .filter((d) => d.kind === 'verification')
                .map((d) => {
                  const b = latest.get(d.code);
                  const status = b?.status;
                  const renewable = status === 'approved' && b?.expires_at && new Date(b.expires_at).getTime() - Date.now() < 30 * 86400_000;
                  const canApply = d.required_documents.length > 0 && (!status || ['rejected', 'expired', 'revoked'].includes(status) || renewable);
                  return (
                    <Card key={d.code} testID={`badge-${d.code}`}>
                      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Strong style={{ flex: 1, fontSize: 19 }}>
                          {badgeIcon(d.code)} {t.dyn(`badge.${d.code}`, d.name)}
                        </Strong>
                        <Pill tone={status ? STATUS_TONE[status] : 'neutral'} label={t.dyn(`badges.status.${status ?? 'none'}`, status ?? '')} />
                      </Row>
                      {d.description ? <Muted>{d.description}</Muted> : null}
                      {required.includes(d.code) ? <Pill tone="danger" label={`⚠️ ${t('badges.required')}`} /> : null}
                      {b?.expires_at && status === 'approved' ? <Muted>{t('badges.expires', { date: formatLongDate(b.expires_at) })}</Muted> : null}
                      {b?.review_note && status !== 'approved' ? <Muted>{t('badges.note', { note: b.review_note })}</Muted> : null}
                      {d.required_documents.length ? <Muted>{t('badges.docsNeeded')}: {d.required_documents.map((x) => t.dyn(`doc.${x}`, x)).join(', ')}</Muted> : null}
                      {canApply ? (
                        <Button
                          title={renewable ? t('badges.renew') : status ? t('badges.applyAgain') : t('badges.apply')}
                          variant="pro"
                          small
                          onPress={() => router.push({ pathname: '/badges/apply/[code]', params: { code: d.code } })}
                          testID={`apply-${d.code}`}
                        />
                      ) : null}
                    </Card>
                  );
                })}

              <SectionTitle>{t('badges.performance')}</SectionTitle>
              <Muted>{t('badges.performanceHint')}</Muted>
              {list
                .filter((d) => d.kind === 'performance')
                .map((d) => {
                  const held = latest.get(d.code)?.status === 'approved';
                  return (
                    <Card key={d.code}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Strong style={{ flex: 1 }}>
                          {badgeIcon(d.code)} {t.dyn(`badge.${d.code}`, d.name)}
                        </Strong>
                        <Pill tone={held ? 'success' : 'neutral'} label={held ? t('badges.status.approved') : '—'} />
                      </Row>
                      {d.description ? <Muted>{d.description}</Muted> : null}
                    </Card>
                  );
                })}
            </View>
          );
        }}
      </QueryView>
    </Screen>
  );
}
