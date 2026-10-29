import type { ReactNode } from 'react';
import { View } from 'react-native';
import { entryKey, formatDateTime, formatTime } from '../domain';
import { errorMessage } from '../errors';
import { formatLeSigned, formatLe } from '../money';
import type { LedgerEntry } from '../types';
import { useI18n, useT } from './i18n';
import { Banner, Body, ErrorState, Loading, Muted, Segmented, Stack } from './primitives';
import type { QueryState } from './query';
import { colors, space } from './theme';

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <Stack gap={space.xs}>
      <Segmented
        options={[
          { value: 'en', label: t('common.english') },
          { value: 'kri', label: t('common.krio') },
        ]}
        value={lang}
        onChange={setLang}
      />
      {lang === 'kri' ? <Muted>{t('common.krioBeta')}</Muted> : null}
    </Stack>
  );
}

/**
 * Renders loading / error / offline states for a query, then `children(data)`.
 * When offline with cached data, shows the data with a banner instead of an error.
 */
export function QueryView<T>({ q, children, empty }: { q: QueryState<T>; children: (data: T) => ReactNode; empty?: (data: T) => boolean | ReactNode }) {
  const t = useT();
  if (q.data === undefined) {
    if (q.loading) return <Loading label={t('common.loading')} />;
    if (q.error) {
      return (
        <ErrorState
          offline={q.offline}
          title={q.offline ? t('common.offline') : t('common.error')}
          message={q.offline ? '' : errorMessage(q.error, t('common.offline'))}
          onRetry={q.reload}
          retryLabel={t('common.retry')}
        />
      );
    }
    return null;
  }
  return (
    <View style={{ gap: space.md }}>
      {q.offline || (q.cachedAt && q.error) ? (
        <Banner tone="warn" icon="📶" title={t('common.offlineCached', { time: q.cachedAt ? formatTime(new Date(q.cachedAt)) : '—' })} action={t('common.retry')} onAction={q.reload} />
      ) : q.error ? (
        <Banner tone="danger" title={errorMessage(q.error, t('common.offline'))} action={t('common.retry')} onAction={q.reload} />
      ) : null}
      {children(q.data)}
    </View>
  );
}

/** Wallet / earnings history lines. */
export function LedgerList({ entries }: { entries: LedgerEntry[] }) {
  const t = useT();
  return (
    <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      {entries.map((e) => (
        <View key={String(e.id)} style={{ flexDirection: 'row', padding: space.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.md, alignItems: 'center' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Body style={{ fontWeight: '700' }}>{t.dyn(entryKey(e.entry_type), e.entry_type)}</Body>
            <Muted numberOfLines={1}>{[formatDateTime(e.created_at), e.memo].filter(Boolean).join(' · ')}</Muted>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Body style={{ fontWeight: '800', color: e.amount_minor >= 0 ? colors.success : colors.danger }}>{formatLeSigned(e.amount_minor)}</Body>
            <Muted>{formatLe(e.running_balance_minor)}</Muted>
          </View>
        </View>
      ))}
    </View>
  );
}
