import { Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { formatDay, formatLe, formatLongDate, sortBadges } from '@fixam/shared';
import {
  BadgeChips, badgeIcon, Body, Card, colors, H2, KV, Muted, Pill, QueryView, Row, Screen, SectionTitle, space, Stars, Strong,
  useApiQuery, useSession, useT,
} from '@fixam/shared/ui';
import { unitText } from '../../src/components';

export default function ProviderProfileScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const q = useApiQuery(`provider:${id}`, () => api.providers.get(id), { cache: true });
  const reviews = useApiQuery(`reviews:${id}`, () => api.providers.reviews(id, { limit: 10 }), { cache: true });

  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <QueryView q={q}>
        {(p) => (
          <View style={{ gap: space.md }}>
            <RouterStack.Screen options={{ title: p.business_name }} />
            <Card>
              <H2>{p.business_name}</H2>
              <Row gap={space.lg} wrap>
                <Strong color="#7A5400">{p.rating_count ? t('providers.rating', { rating: Number(p.rating_avg).toFixed(1), count: p.rating_count }) : t('providers.new')}</Strong>
                <Body>{t('providers.jobs', { count: p.completed_jobs })}</Body>
                {!p.is_available ? <Pill tone="warn" label={t('providers.busy')} /> : null}
              </Row>
              <BadgeChips codes={p.badge_codes} />
              {p.bio ? <Body>{p.bio}</Body> : null}
            </Card>

            <SectionTitle>{t('providers.badges')}</SectionTitle>
            <Card>
              {sortBadges(p.badges.map((b) => b.code)).map((code) => {
                const b = p.badges.find((x) => x.code === code)!;
                return (
                  <Row key={b.code} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Strong>
                        {badgeIcon(b.code)} {t.dyn(`badge.${b.code}`, b.name)}
                      </Strong>
                      <Muted>{b.expires_at ? t('verify.until', { date: formatLongDate(b.expires_at) }) : t('verify.noExpiry')}</Muted>
                    </View>
                    <Muted>{b.verification_code}</Muted>
                  </Row>
                );
              })}
            </Card>

            <SectionTitle>{t('providers.services')}</SectionTitle>
            <Card>
              {p.services.map((s) => (
                <KV key={s.id} k={s.name} v={`${formatLe(s.price_minor)} ${s.price_unit === 'fixed' ? '' : unitText(t, s)}`.trim()} />
              ))}
            </Card>

            <SectionTitle>{t('providers.areas')}</SectionTitle>
            <Row wrap gap={6}>
              {p.zones.map((z) => (
                <Pill key={z.id} tone="info" label={z.name} />
              ))}
            </Row>
          </View>
        )}
      </QueryView>

      <SectionTitle>{t('providers.reviews')}</SectionTitle>
      <QueryView q={reviews}>
        {(rows) =>
          rows.length ? (
            <View style={{ gap: space.sm }}>
              {rows.map((r, i) => (
                <Card key={i}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Stars value={r.rating} size={20} />
                    <Muted>{formatDay(r.created_at)}</Muted>
                  </Row>
                  {r.comment ? <Body>{r.comment}</Body> : null}
                  <Muted>
                    {r.customer_first_name ?? ''} · {r.service_name}
                  </Muted>
                </Card>
              ))}
            </View>
          ) : (
            <Muted>{t('providers.noReviews')}</Muted>
          )
        }
      </QueryView>
      <View style={{ height: 1, backgroundColor: colors.border }} />
    </Screen>
  );
}
