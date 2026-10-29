import { Stack as RouterStack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import {
  ApiError, errorMessage, formatDateTime, formatLe, formatLocalPhone, jobActions, peakLabels, statusTone, telUrl, type Booking,
} from '@fixam/shared';
import {
  Banner, Body, Button, Card, Choice, CodeInput, colors, Field, H2, KV, Muted, Pill, QueryView, Row, Screen, SectionTitle, space,
  Strong, useApiQuery, useSession, useT,
} from '@fixam/shared/ui';

export default function JobDetail() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const isProvider = user?.role === 'provider';
  const q = useApiQuery(`job:${id}`, () => api.bookings.get(id), { cache: true });
  const team = useApiQuery(isProvider ? 'team' : null, () => api.providers.servicemen());
  const b = q.data;
  // Rough "what you keep" before settlement, from the provider's own plan.
  const preview = useApiQuery(
    isProvider && b && b.provider_earning_minor == null ? `preview:${b.service_id}:${b.subtotal_minor}:${b.surcharge_minor}` : null,
    () => api.providers.commissionPreview({ serviceId: b!.service_id, subtotalMinor: b!.subtotal_minor, surchargeMinor: b!.surcharge_minor }),
  );
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [panel, setPanel] = useState<null | 'assign' | 'withdraw'>(null);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  const run = async (fn: () => Promise<Booking>, okText?: string) => {
    setMsg(null);
    try {
      const next = await fn();
      q.setData(next);
      setCode('');
      setPanel(null);
      if (okText) setMsg({ tone: 'success', text: okText });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_taken') setMsg({ tone: 'danger', text: t('jobs.taken') });
      else setMsg({ tone: 'danger', text: errorMessage(e, t('common.offline')) });
      if (e instanceof ApiError && e.status !== 400) void q.reload();
    }
  };

  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <QueryView q={q}>
        {(job) => {
          const actions = user ? jobActions(job, { role: user.role, providerId: user.provider_id, servicemanId: user.serviceman_id }) : [];
          const a = job.address;
          const cash = job.payment_method === 'cash';
          const labels = peakLabels(job.price_breakdown);
          const mapUrl = a.lat != null && a.lng != null ? (Platform.OS === 'ios' ? `maps:0,0?q=${a.lat},${a.lng}` : `https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`) : null;
          return (
            <View style={{ gap: space.md }}>
              <RouterStack.Screen options={{ title: t('job.title', { code: job.code }) }} />
              <Card>
                <Row wrap gap={6}>
                  <Pill tone={statusTone(job.status)} label={t.dyn(`status.${job.status}`, job.status)} />
                  {job.is_emergency ? <Pill tone="danger" icon="⚡" label={t('jobs.urgent')} /> : null}
                  {job.surcharge_minor > 0 ? <Pill tone="accent" icon="⏰" label={labels.join(' + ') || t('jobs.peak')} /> : null}
                </Row>
                <H2>{job.service_name}</H2>
                <KV k={t('job.when')} v={job.is_emergency ? t('book.asap') : formatDateTime(job.scheduled_at)} />
                <KV k={t('common.total')} v={formatLe(job.total_minor)} bold />
                <KV
                  k={t('confirm.payWith')}
                  v={cash ? t('job.collectCash', { amount: formatLe(job.total_minor) }) : job.payment_status === 'paid' ? `✅ ${t('job.paidOnline')}` : t('job.notPaid')}
                  color={cash ? colors.warn : job.payment_status === 'paid' ? colors.success : colors.danger}
                />
                {isProvider && job.provider_earning_minor != null ? (
                  <>
                    <KV k={t('job.commission')} v={`-${formatLe(job.commission_minor ?? 0)}`} />
                    <KV k={t('job.gst')} v={`-${formatLe(job.commission_gst_minor ?? 0)}`} />
                    <KV k={t('job.earning')} v={formatLe(job.provider_earning_minor)} bold color={colors.success} />
                  </>
                ) : isProvider && preview.data ? (
                  <KV k={t('job.earning')} v={`≈ ${formatLe(preview.data.providerEarningMinor)}`} bold color={colors.success} />
                ) : null}
              </Card>

              <Card>
                <Muted>{t('job.landmark')}</Muted>
                <Strong style={{ fontSize: 20 }}>📍 {a.landmark}</Strong>
                <KV k={t('job.area')} v={`${a.area} · ${job.zone_name}`} />
                {a.street ? <KV k={t('job.street')} v={a.street} /> : null}
                {job.notes ? <KV k={t('job.notes')} v={job.notes} /> : null}
                {mapUrl ? <Button title={`🗺️ ${t('job.map')}`} variant="secondary" small onPress={() => Linking.openURL(mapUrl)} /> : null}
              </Card>

              <Card>
                <Muted>{t('job.customer')}</Muted>
                <Strong style={{ fontSize: 19 }}>{job.customer_name ?? '—'}</Strong>
                {job.customer_phone || a.contactPhone ? <Body>📱 {formatLocalPhone(a.contactPhone ?? job.customer_phone)}</Body> : null}
                {job.customer_phone || a.contactPhone ? (
                  <Button title={`📞 ${t('job.call')}`} variant="pro" onPress={() => Linking.openURL(telUrl((a.contactPhone ?? job.customer_phone)!))} testID="call-customer" />
                ) : (
                  <Muted>{t('job.hiddenUntilAccept')}</Muted>
                )}
                {job.serviceman_name ? <Body>👷 {t('job.assignedTo', { name: job.serviceman_name })}</Body> : null}
              </Card>

              {msg ? <Banner tone={msg.tone} title={msg.text} /> : null}

              {actions.includes('accept') ? <Button title={t('jobs.accept')} variant="pro" onPress={() => run(() => api.bookings.accept(job.id), t('jobs.accepted'))} /> : null}

              {actions.includes('assign') ? (
                panel === 'assign' ? (
                  <Card>
                    <Strong>{t('job.assign')}</Strong>
                    {(team.data ?? []).filter((s) => s.active).length === 0 ? <Muted>{t('job.noTeam')}</Muted> : null}
                    {(team.data ?? [])
                      .filter((s) => s.active)
                      .map((s) => (
                        <Choice
                          key={s.id}
                          title={s.name ?? formatLocalPhone(s.phone)}
                          subtitle={`${formatLocalPhone(s.phone)} · ${t('team.activeJobs', { count: s.active_jobs })}`}
                          selected={job.serviceman_id === s.id}
                          onPress={() => run(() => api.bookings.assign(job.id, s.id))}
                        />
                      ))}
                    <Button title={t('common.cancel')} variant="ghost" onPress={() => setPanel(null)} />
                  </Card>
                ) : (
                  <Button title={`👷 ${t('job.assign')}`} variant="secondary" onPress={() => setPanel('assign')} />
                )
              ) : null}

              {actions.includes('en_route') ? <Button title={`🛵 ${t('job.enRoute')}`} variant="pro" onPress={() => run(() => api.bookings.enRoute(job.id))} testID="en-route" /> : null}

              {actions.includes('start') || actions.includes('complete') ? (
                <Card style={{ borderColor: colors.pro, borderWidth: 2 }} testID="code-entry">
                  <SectionTitle>{actions.includes('start') ? t('job.start') : t('job.complete')}</SectionTitle>
                  <CodeInput label={actions.includes('start') ? t('job.startCode') : t('job.completeCode')} value={code} onChange={setCode} length={4} testID="job-code" color={colors.pro} />
                  <Muted>{t('job.codeHint')}</Muted>
                  <Button
                    title={actions.includes('start') ? `▶ ${t('job.start')}` : `✔ ${t('job.complete')}`}
                    variant="pro"
                    disabled={code.length !== 4}
                    testID="submit-code"
                    onPress={() =>
                      run(
                        () => (actions.includes('start') ? api.bookings.start(job.id, code) : api.bookings.complete(job.id, code)),
                        undefined,
                      )
                    }
                  />
                </Card>
              ) : null}

              {job.status === 'completed' ? <Banner tone="success" icon="🎉" title={t('job.done')} /> : null}

              {actions.includes('withdraw') ? (
                panel === 'withdraw' ? (
                  <Card tone="neutral">
                    <Field label={t('job.withdrawReason')} value={reason} onChangeText={setReason} multiline />
                    <Button title={t('job.withdraw')} variant="danger" disabled={reason.trim().length < 3} onPress={() => run(() => api.bookings.cancel(job.id, reason.trim())).then(() => router.back())} />
                    <Button title={t('common.cancel')} variant="ghost" onPress={() => setPanel(null)} />
                  </Card>
                ) : (
                  <Button title={t('job.withdraw')} variant="ghost" onPress={() => setPanel('withdraw')} />
                )
              ) : null}

              <SectionTitle>{t('detail.progress')}</SectionTitle>
              <Card>
                {job.events.map((e, i) => (
                  <KV key={i} k={t.dyn(`status.${e.to_status}`, e.to_status)} v={formatDateTime(e.created_at)} />
                ))}
              </Card>
            </View>
          );
        }}
      </QueryView>
    </Screen>
  );
}
