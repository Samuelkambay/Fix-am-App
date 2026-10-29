import { View } from 'react-native';
import { formatDateTime, formatLe, statusTone, type BookingListItem } from '@fixam/shared';
import { Card, colors, Muted, Pill, Row, space, Strong, useApiQuery, useSession, useT, Button } from '@fixam/shared/ui';

export function useProviderMe() {
  const { api } = useSession();
  return useApiQuery('provider:me', () => api.providers.me(), { cache: true });
}

/** A job in a list: service, area/landmark, price and the tags providers care about (peak, urgent). */
export function JobCard({ job, onPress, onAccept, showStatus = true }: { job: BookingListItem; onPress?: () => void; onAccept?: () => unknown; showStatus?: boolean }) {
  const t = useT();
  return (
    <Card onPress={onPress} testID={`job-${job.code}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Row wrap gap={6}>
            {job.is_emergency ? <Pill tone="danger" icon="⚡" label={t('jobs.urgent')} /> : null}
            {job.surcharge_minor > 0 ? <Pill tone="accent" icon="⏰" label={`${t('jobs.peak')} +${formatLe(job.surcharge_minor)}`} /> : null}
            {showStatus && job.status !== 'pending' ? <Pill tone={statusTone(job.status)} label={t.dyn(`status.${job.status}`, job.status)} /> : null}
            {job.status === 'pending' && job.provider_name ? <Pill tone="info" label={t('jobs.direct')} /> : null}
          </Row>
          <Strong style={{ fontSize: 19 }}>{job.service_name}</Strong>
        </View>
        <Strong style={{ fontSize: 22, color: colors.pro }}>{formatLe(job.total_minor)}</Strong>
      </Row>
      <Muted>🕑 {formatDateTime(job.scheduled_at)}</Muted>
      <Muted numberOfLines={2}>
        📍 {job.area} · {job.landmark}
      </Muted>
      <Muted>
        {t.dyn(`method.${job.payment_method}`, job.payment_method)} · {t.dyn(`payStatus.${job.payment_status}`, job.payment_status)} · {job.code}
      </Muted>
      {onAccept ? <Button title={t('jobs.accept')} variant="pro" onPress={onAccept} testID={`accept-${job.code}`} /> : null}
    </Card>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 2 }}>
      <Muted>{label}</Muted>
      <Strong style={{ fontSize: 22, color: tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : colors.text }}>{value}</Strong>
    </View>
  );
}
