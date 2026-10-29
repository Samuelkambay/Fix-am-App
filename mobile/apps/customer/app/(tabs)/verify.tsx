import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { errorMessage, formatLongDate, type BadgeVerifyResult } from '@fixam/shared';
import { Banner, badgeIcon, Body, Button, Card, colors, Field, KV, Muted, Screen, space, useSession, useT } from '@fixam/shared/ui';

/** Public badge check: a customer verifies the code on a handyman's badge before letting them in. */
export default function Verify() {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const { api } = useSession();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<BadgeVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (c = code) => {
    setError(null);
    setResult(null);
    try {
      setResult(await api.badges.verify(c));
    } catch (e) {
      setError(errorMessage(e, t('common.offline')));
    }
  };

  useEffect(() => {
    if (params.code) {
      setCode(params.code);
      void check(params.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  const normalized = code.trim().toUpperCase();
  const looksValid = /^FXB-[A-Z0-9]{4,10}$/.test(normalized) || /^[A-Z0-9]{6}$/.test(normalized);

  return (
    <Screen>
      <Body>{t('verify.hint')}</Body>
      <Field
        label={t('verify.codeLabel')}
        value={code}
        onChangeText={(v) => {
          setCode(v.toUpperCase());
          setResult(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="FXB-XXXXXX"
        style={{ fontSize: 26, fontWeight: '800', letterSpacing: 2 }}
        testID="badge-code-input"
      />
      <Button title={t('verify.check')} onPress={() => check(/^[A-Z0-9]{6}$/.test(normalized) ? `FXB-${normalized}` : normalized)} disabled={!looksValid} testID="verify-button" />
      {Platform.OS !== 'web' ? <Button title={`📷 ${t('verify.scan')}`} variant="secondary" onPress={() => router.push('/scan')} /> : null}
      {error ? <Banner tone="danger" title={error} /> : null}

      {result ? (
        <Card style={{ borderWidth: 4, borderColor: result.valid ? colors.success : colors.danger, backgroundColor: result.valid ? colors.successSoft : colors.dangerSoft, alignItems: 'center' }} testID="verify-result">
          <Text style={{ fontSize: 72 }}>{result.valid ? '✅' : '⛔'}</Text>
          <Text style={{ fontSize: 44, fontWeight: '900', color: result.valid ? colors.success : colors.danger, letterSpacing: 2 }}>
            {result.valid ? t('verify.valid') : t('verify.notValid')}
          </Text>
          {!result.valid ? <Body center style={{ fontWeight: '700' }}>{t.dyn(`verify.reason.${result.reason}`, t('verify.reason.unknown_code'))}</Body> : null}
          {result.provider ? (
            <View style={{ alignSelf: 'stretch', gap: space.xs, marginTop: space.sm }}>
              <KV k={t('verify.business')} v={result.provider} bold />
              {result.ownerName ? <KV k={t('verify.owner')} v={result.ownerName} /> : null}
              {result.badgeCode ? <KV k={t('verify.badge')} v={`${badgeIcon(result.badgeCode)} ${t.dyn(`badge.${result.badgeCode}`, result.badge ?? '')}`} /> : null}
              {result.rating != null ? <KV k={t('dash.rating')} v={`★ ${Number(result.rating).toFixed(1)} · ${t('providers.jobs', { count: result.completedJobs ?? 0 })}`} /> : null}
              <Muted center>{result.expiresAt ? t('verify.until', { date: formatLongDate(result.expiresAt) }) : t('verify.noExpiry')}</Muted>
            </View>
          ) : null}
          {!result.valid ? <Banner tone="danger" icon="🚫" title={t('verify.warning')} /> : null}
        </Card>
      ) : null}
    </Screen>
  );
}
