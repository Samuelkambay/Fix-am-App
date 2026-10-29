import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  formatCountdown, formatDateTime, formatLe, formatTime, peakLabels, savingVersus, STATUS_FLOW, summariseCurve,
  type Booking, type BookingStatus, type DayCurveHour, type ProviderSummary, type Quote, type Service,
} from '@fixam/shared';
import {
  BadgeChips, Banner, Body, Button, Card, colors, KV, Money, Muted, Pill, Row, space, Strong, useT,
} from '@fixam/shared/ui';

const CATEGORY_ICON: Record<string, string> = {
  bolt: '⚡', droplet: '💧', sun: '☀️', snowflake: '❄️', hammer: '🔨', brick: '🧱', sparkles: '✨', flame: '🔥', tv: '📺',
};

export function categoryIcon(icon: string | null | undefined): string {
  return (icon && CATEGORY_ICON[icon]) || '🛠️';
}

export function unitText(t: ReturnType<typeof useT>, s: Pick<Service, 'price_unit' | 'unit_label'>): string {
  if (s.price_unit === 'hourly') return t('service.perHour');
  if (s.price_unit === 'per_unit') return s.unit_label ? t('service.perUnit', { unit: s.unit_label }) : t('service.perItem');
  return t('service.fixed');
}

// ───────── Price-by-hour strip ─────────
export function PriceStrip({ hours, selectedAt, onSelect, now = new Date() }: { hours: DayCurveHour[]; selectedAt: string | null; onSelect: (h: DayCurveHour) => void; now?: Date }) {
  const t = useT();
  const summary = summariseCurve(hours, now);
  if (!summary.hours.length) return <Banner tone="info" title={t('book.noTimesLeft')} />;
  const selected = summary.hours.find((h) => h.at === selectedAt) ?? null;
  const cheapest = summary.cheapest!;
  const saving = selected ? savingVersus(summary, selected) : summary.maxSavingMinor;
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const selIdx = summary.hours.findIndex((h) => h.at === selectedAt);
  useEffect(() => {
    // Keep the chosen hour in view (cells are 96 wide + 8 gap); show one cell of context on the left.
    if (selIdx >= 0) scroller.current?.scrollTo({ x: Math.max(0, (selIdx - 1) * 104), animated: true });
  }, [selIdx]);

  return (
    <View style={{ gap: space.sm }}>
      {saving > 0 ? (
        <Banner
          tone="accent"
          icon="💰"
          testID="save-banner"
          title={t('book.saveAt', { amount: formatLe(saving), time: formatTime(cheapest.at) })}
          action={selected?.at !== cheapest.at ? formatTime(cheapest.at) : undefined}
          onAction={() => onSelect(cheapest)}
        />
      ) : (
        <Banner tone="success" icon="✅" title={t('book.bestPriceAt', { time: formatTime(cheapest.at) })} />
      )}
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 4 }}>
        {summary.hours.map((h) => {
          const on = h.at === selectedAt;
          const peak = h.surchargeMinor > 0;
          return (
            <Pressable
              key={h.at}
              testID={`hour-${h.hour}`}
              onPress={() => onSelect(h)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${formatTime(h.at)} ${formatLe(h.totalMinor)}${h.isCheapest ? `, ${t('book.cheapest')}` : ''}${h.labels.length ? `, ${h.labels.join(', ')}` : ''}`}
              style={[styles.hour, h.isCheapest && styles.hourCheap, peak && styles.hourPeak, on && styles.hourOn]}
            >
              <Text style={[styles.hourTime, on && { color: colors.white }]}>{formatTime(h.at)}</Text>
              <Text style={[styles.hourPrice, on && { color: colors.white }]}>{formatLe(h.totalMinor)}</Text>
              {h.isCheapest ? (
                <Text style={[styles.hourTag, { color: on ? colors.white : '#7A5400' }]}>{t('book.cheapest')}</Text>
              ) : peak ? (
                <Text style={[styles.hourTag, { color: on ? colors.white : colors.danger }]} numberOfLines={1}>
                  ⏰ {`+${Math.round((h.multiplier - 1) * 100)}%`}
                </Text>
              ) : (
                <Text style={styles.hourTag}> </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      {summary.hours.some((h) => h.surchargeMinor > 0) ? (
        <Muted>⏰ {[...new Set(summary.hours.flatMap((h) => h.labels))].join(' · ')}</Muted>
      ) : null}
    </View>
  );
}

// ───────── Quote breakdown with 15-minute lock ─────────
export function useCountdown(expiresAt: string | null | undefined): number {
  const [left, setLeft] = useState(() => (expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0));
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setLeft(new Date(expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

export function QuoteCard({ quote, onRequote }: { quote: Quote; onRequote?: () => void }) {
  const t = useT();
  const left = useCountdown(quote.expires_at);
  const expired = left <= 0;
  const labels = peakLabels(quote.breakdown);
  return (
    <Card testID="quote-card">
      <Row style={{ justifyContent: 'space-between' }}>
        <Strong>{t('book.yourPrice')}</Strong>
        {quote.is_emergency ? <Pill tone="danger" label={t('book.urgent')} /> : <Muted>{formatDateTime(quote.scheduled_at)}</Muted>}
      </Row>
      {quote.breakdown.lines.map((l, i) => (
        <KV key={i} k={l.label} v={formatLe(l.amountMinor)} color={i > 0 ? colors.danger : undefined} />
      ))}
      {labels.length ? (
        <Row wrap gap={6}>
          {labels.map((l) => (
            <Pill key={l} tone="danger" icon="⏰" label={l} />
          ))}
        </Row>
      ) : null}
      {quote.breakdown.cappedBy ? <Muted>🛡️ {t('book.capped')}</Muted> : null}
      <View style={{ height: 1, backgroundColor: colors.border }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Strong style={{ fontSize: 20 }}>{t('common.total')}</Strong>
        <Money minor={quote.total_minor} size="title" />
      </Row>
      {expired ? (
        <Banner tone="warn" title={t('book.priceExpired')} action={onRequote ? t('book.newPrice') : undefined} onAction={onRequote} />
      ) : (
        <View style={styles.lock} testID="price-lock">
          <Text style={styles.lockText}>🔒 {t('book.priceHeld', { time: formatCountdown(left) })}</Text>
        </View>
      )}
    </Card>
  );
}

// ───────── Provider card ─────────
export function ProviderCard({ p, onPress, onChoose, chosen, basePriceMinor }: { p: ProviderSummary; onPress?: () => void; onChoose?: () => void; chosen?: boolean; basePriceMinor?: number }) {
  const t = useT();
  const price = p.price_override_minor ?? basePriceMinor;
  return (
    <Card onPress={onPress} style={chosen ? { borderColor: colors.brand, borderWidth: 2 } : undefined}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Strong style={{ fontSize: 19 }}>{p.business_name}</Strong>
          <Row gap={space.md} wrap>
            <Body style={{ fontWeight: '700', color: '#7A5400' }}>
              {p.rating_count > 0 ? t('providers.rating', { rating: Number(p.rating_avg).toFixed(1), count: p.rating_count }) : t('providers.new')}
            </Body>
            <Muted>{t('providers.jobs', { count: p.completed_jobs })}</Muted>
          </Row>
        </View>
        {price != null ? <Money minor={price} size="large" /> : null}
      </Row>
      <BadgeChips codes={p.badges} max={4} />
      {!p.is_available ? <Pill tone="warn" label={t('providers.busy')} /> : null}
      {onChoose ? <Button title={chosen ? `✓ ${t('providers.chosen')}` : t('providers.choose')} variant={chosen ? 'primary' : 'secondary'} small onPress={onChoose} /> : null}
    </Card>
  );
}

// ───────── Status timeline ─────────
export function StatusTimeline({ booking }: { booking: Booking }) {
  const t = useT();
  const steps: BookingStatus[] = STATUS_FLOW.filter((s) => s !== 'assigned' || booking.serviceman_id || booking.events.some((e) => e.to_status === 'assigned'));
  const terminal = booking.status === 'cancelled' || booking.status === 'disputed';
  const reachedAt = (s: BookingStatus) => booking.events.find((e) => e.to_status === s)?.created_at;
  const currentIdx = steps.indexOf(booking.status);
  return (
    <View style={{ gap: 0 }}>
      {steps.map((s, i) => {
        const at = reachedAt(s);
        const done = !!at || (currentIdx >= 0 && i <= currentIdx);
        const current = s === booking.status;
        return (
          <View key={s} style={styles.tlRow}>
            <View style={{ alignItems: 'center', width: 28 }}>
              <View style={[styles.tlDot, done && { backgroundColor: colors.brand, borderColor: colors.brand }, current && { width: 22, height: 22, borderRadius: 11 }]} />
              {i < steps.length - 1 ? <View style={[styles.tlLine, done && { backgroundColor: colors.brand }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: space.md }}>
              <Body style={[{ color: done ? colors.text : colors.textMuted }, current && { fontWeight: '800' }]}>{t.dyn(`status.${s}`, s)}</Body>
              {at ? <Muted>{formatDateTime(at)}</Muted> : null}
            </View>
          </View>
        );
      })}
      {terminal ? (
        <Banner
          tone={booking.status === 'cancelled' ? 'neutral' : 'danger'}
          title={t.dyn(`status.${booking.status}`, booking.status)}
          body={booking.cancel_reason ?? booking.dispute_reason ?? undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hour: { width: 96, minHeight: 92, borderRadius: 12, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 2 },
  hourCheap: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  hourPeak: { borderColor: '#F3C2C2' },
  hourOn: { backgroundColor: colors.brand, borderColor: colors.brandDark },
  hourTime: { fontSize: 18, fontWeight: '800', color: colors.text },
  hourPrice: { fontSize: 15, fontWeight: '700', color: colors.text },
  hourTag: { fontSize: 13, fontWeight: '800', color: colors.textMuted },
  lock: { backgroundColor: colors.infoSoft, borderRadius: 10, padding: space.md, alignItems: 'center' },
  lockText: { fontSize: 18, fontWeight: '800', color: colors.info, fontVariant: ['tabular-nums'] },
  tlRow: { flexDirection: 'row', gap: space.md },
  tlDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: colors.border, backgroundColor: colors.card },
  tlLine: { flex: 1, width: 3, backgroundColor: colors.border, minHeight: 18 },
});
