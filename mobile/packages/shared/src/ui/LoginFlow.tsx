import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorMessage } from '../errors';
import { formatLocalPhone, formatPhoneAsYouType, tryNormalizeSlPhone } from '../phone';
import type { LoginResult } from '../types';
import { LanguageToggle } from './common';
import { useT } from './i18n';
import { Banner, Body, Button, CodeInput, Field, H1, Muted, Screen, Stack } from './primitives';
import { useSession } from './session';
import { colors, space } from './theme';

type Step = 'phone' | 'code' | 'name';

/** Phone (076 123 456) -> 6-digit SMS code -> name (first login). Used by both apps. */
export function LoginFlow({ variant, onDone }: { variant: 'customer' | 'pro'; onDone?: (res: LoginResult) => void }) {
  const t = useT();
  const { api, onLoggedIn, updateUser } = useSession();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [result, setResult] = useState<LoginResult | null>(null);
  const brand = variant === 'pro' ? colors.pro : colors.brand;

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const e164 = tryNormalizeSlPhone(phone);

  const sendCode = async () => {
    setError(null);
    if (!e164) {
      setError(t('login.phoneInvalid'));
      return;
    }
    try {
      const r = await api.auth.requestOtp(e164);
      setDevCode(r.devCode ?? null);
      setCode('');
      setStep('code');
      setResendIn(30);
    } catch (e) {
      setError(errorMessage(e, t('common.offline')));
    }
  };

  const verify = async () => {
    setError(null);
    try {
      const res = await api.auth.verifyOtp({ phone: e164!, code });
      if (!res.user.name) {
        setResult(res);
        setStep('name');
        return;
      }
      await onLoggedIn(res);
      onDone?.(res);
    } catch (e) {
      setError(errorMessage(e, t('common.offline')));
    }
  };

  const saveName = async () => {
    if (!result || name.trim().length < 2) return;
    setError(null);
    try {
      const u = await api.auth.updateMe({ name: name.trim() });
      await onLoggedIn({ ...result, user: u });
      updateUser(u);
      onDone?.({ ...result, user: u });
    } catch (e) {
      setError(errorMessage(e, t('common.offline')));
    }
  };

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ alignItems: 'center', gap: space.xs, marginTop: space.xl, marginBottom: space.lg }}>
        <View style={{ width: 88, height: 88, borderRadius: 24, backgroundColor: brand, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 44 }}>{variant === 'pro' ? '🧰' : '🔧'}</Text>
        </View>
        <H1 color={brand}>{variant === 'pro' ? t('login.proTitle') : t('login.customerTitle')}</H1>
        <Body center>{variant === 'pro' ? t('login.proTagline') : t('login.customerTagline')}</Body>
      </View>

      {step === 'phone' ? (
        <Stack>
          <LanguageToggle />
          <Field
            label={t('login.phoneLabel')}
            value={phone}
            onChangeText={(v) => setPhone(formatPhoneAsYouType(v))}
            keyboardType="phone-pad"
            inputMode="tel"
            autoComplete="tel"
            placeholder="076 123 456"
            maxLength={11}
            testID="phone-input"
            error={error}
          />
          <Button title={t('login.sendCode')} onPress={sendCode} disabled={!e164} variant={variant === 'pro' ? 'pro' : 'primary'} testID="send-code" />
        </Stack>
      ) : null}

      {step === 'code' ? (
        <Stack>
          <Body>{t('login.codeSent', { phone: formatLocalPhone(e164) })}</Body>
          {devCode ? <Banner tone="accent" icon="🧪" title={t('login.devCode', { code: devCode })} /> : null}
          <CodeInput label={t('login.codeLabel')} value={code} onChange={setCode} length={6} testID="otp-input" />
          {error ? <Banner tone="danger" title={error} /> : null}
          <Button title={t('login.verify')} onPress={verify} disabled={code.length !== 6} variant={variant === 'pro' ? 'pro' : 'primary'} testID="verify-code" />
          <Button title={resendIn > 0 ? t('login.resendIn', { seconds: resendIn }) : t('login.resend')} onPress={sendCode} disabled={resendIn > 0} variant="ghost" />
          <Button title={t('login.changeNumber')} onPress={() => setStep('phone')} variant="ghost" />
        </Stack>
      ) : null}

      {step === 'name' ? (
        <Stack>
          <H1>{t('login.nameTitle')}</H1>
          <Field label={t('login.nameLabel')} value={name} onChangeText={setName} autoComplete="name" autoCapitalize="words" error={error} />
          <Button title={t('login.nameSave')} onPress={saveName} disabled={name.trim().length < 2} variant={variant === 'pro' ? 'pro' : 'primary'} />
          <Muted>{formatLocalPhone(e164)}</Muted>
        </Stack>
      ) : null}
    </Screen>
  );
}
