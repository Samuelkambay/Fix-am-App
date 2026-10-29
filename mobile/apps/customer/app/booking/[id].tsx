import { Stack as RouterStack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import {
  customerCanCancel, customerCanDispute, customerCanReview, errorMessage, formatDateTime, formatLe, formatLocalPhone,
  needsPayment, peakLabels, statusTone, telUrl, type Booking,
} from '@fixam/shared';
import {
  Banner, BigCode, Body, Button, Card, colors, Field, H2, KV, Muted, Pill, QueryView, Row, Screen, SectionTitle, space, Stars,
  Strong, useApiQuery, useSession, useT,
} from '@fixam/shared/ui';
import { StatusTimeline } from '../../src/components';

type Panel = null | 'cancel' | 'dispute';

export default function BookingDetail() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const q = useApiQuery(`booking:${id}`, () => api.bookings.get(id), { cache: true, pollMs: 15_000 });
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<Booking | unknown>) => {
    setError(null);
    try {
      await fn();
      setPanel(null);
      setReason('');
      await q.reload();
    } catch (e) {
      setError(errorMessage(e, t('common.offline')));
    }
  };

  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <QueryView q={q}>
        {(b) => {
          const showStart = !!b.start_code && ['accepted', 'assigned', 'en_route'].includes(b.status);
          const showComplete = !!b.completion_code;
          const labels = peakLabels(b.price_breakdown);
          return (
            <View style={{ gap: space.md }}>
              <RouterStack.Screen options={{ title: b.code }} />
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Pill tone={statusTone(b.status) === 'neutral' ? 'neutral' : statusTone(b.status)} label={t.dyn(`status.${b.status}`, b.status)} />
                  <Muted>{t('bookings.code', { code: b.code })}</Muted>
                </Row>
                <H2>{b.service_name}</H2>
                <Body>{b.is_emergency ? `⚡ ${t('book.asap')}` : `🕑 ${formatDateTime(b.scheduled_at)}`}</Body>
                <Body>📍 {b.address.area} · {b.address.landmark}</Body>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Muted>
                    {t.dyn(`method.${b.payment_method}`, b.payment_method)} · {t.dyn(`payStatus.${b.payment_status}`, b.payment_status)}
                  </Muted>
                  <Strong style={{ fontSize: 22 }}>{formatLe(b.total_minor)}</Strong>
                </Row>
              </Card>

              {needsPayment(b) ? (
                <Banner tone="warn" icon="💳" title={t.dyn(`payStatus.${b.payment_status}`, b.payment_status)} action={t('detail.payNow')} onAction={() => router.push({ pathname: '/pay/[bookingId]', params: { bookingId: b.id } })} />
              ) : null}

              {showStart ? <BigCode testID="start-code" code={b.start_code!} label={t('detail.startCode')} hint={t('detail.startCodeHint')} /> : null}
              {showComplete ? <BigCode testID="completion-code" code={b.completion_code!} tone="accent" label={t('detail.completionCode')} hint={t('detail.completionCodeHint')} /> : null}

              {b.provider_name ? (
                <Card>
                  <Muted>{t('detail.fixer')}</Muted>
                  <Strong style={{ fontSize: 20 }}>{b.provider_name}</Strong>
                  {b.provider_rating ? <Body color="#7A5400">★ {Number(b.provider_rating).toFixed(1)}</Body> : null}
                  {b.serviceman_name ? <Body>{t('detail.worker', { name: b.serviceman_name })}</Body> : null}
                  {b.serviceman_phone || b.provider_phone ? <Body>📱 {formatLocalPhone(b.serviceman_phone ?? b.provider_phone)}</Body> : null}
                  {b.serviceman_phone || b.provider_phone ? (
                    <Button
                      title={`📞 ${t('detail.callFixer')}`}
                      variant="secondary"
                      onPress={() => Linking.openURL(telUrl((b.serviceman_phone ?? b.provider_phone)!))}
                    />
                  ) : null}
                </Card>
              ) : null}

              {customerCanReview(b) ? (
                <Card tone="accent">
                  <Strong>{t('detail.rate')}</Strong>
                  <Stars value={rating} onChange={setRating} />
                  <Field label={t('detail.rateComment')} optional optionalText={t('common.optional')} value={comment} onChangeText={setComment} multiline />
                  <Button title={t('detail.rateSend')} disabled={!rating} onPress={() => act(() => api.reviews.create({ bookingId: b.id, rating, comment: comment.trim() || undefined }))} />
                </Card>
              ) : b.review_rating ? (
                <Banner tone="success" title={t('detail.rated', { rating: b.review_rating })} body={t('detail.tenki')} />
              ) : null}

              <SectionTitle>{t('detail.progress')}</SectionTitle>
              <Card>
                <StatusTimeline booking={b} />
              </Card>

              <SectionTitle>{t('detail.price')}</SectionTitle>
              <Card>
                {b.price_breakdown.lines.map((l, i) => (
                  <KV key={i} k={l.label} v={formatLe(l.amountMinor)} />
                ))}
                {labels.length ? <Muted>⏰ {labels.join(' · ')}</Muted> : null}
                <KV k={t('common.total')} v={formatLe(b.total_minor)} bold />
              </Card>

              {error ? <Banner tone="danger" title={error} /> : null}

              {panel ? (
                <Card tone={panel === 'cancel' ? 'neutral' : 'danger'}>
                  <Field
                    label={panel === 'cancel' ? t('detail.cancelReason') : t('detail.disputeReason')}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    error={reason.length > 0 && reason.trim().length < (panel === 'cancel' ? 3 : 5) ? t('detail.reasonTooShort') : null}
                  />
                  {panel === 'cancel' && b.payment_status === 'paid' ? <Muted>{t('detail.refundNote')}</Muted> : null}
                  <Button
                    title={panel === 'cancel' ? t('detail.cancelConfirm') : t('detail.disputeSend')}
                    variant="danger"
                    disabled={reason.trim().length < (panel === 'cancel' ? 3 : 5)}
                    onPress={() => act(() => (panel === 'cancel' ? api.bookings.cancel(b.id, reason.trim()) : api.bookings.dispute(b.id, reason.trim())))}
                  />
                  <Button title={t('common.back')} variant="ghost" onPress={() => setPanel(null)} />
                </Card>
              ) : (
                <View style={{ gap: space.sm }}>
                  {customerCanDispute(b) ? <Button title={`⚠️ ${t('detail.dispute')}`} variant="secondary" onPress={() => setPanel('dispute')} /> : null}
                  {customerCanCancel(b) ? <Button title={t('detail.cancel')} variant="ghost" onPress={() => setPanel('cancel')} /> : null}
                </View>
              )}
              <View style={{ height: 1, backgroundColor: colors.border }} />
            </View>
          );
        }}
      </QueryView>
    </Screen>
  );
}
