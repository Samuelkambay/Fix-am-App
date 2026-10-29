import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { errorMessage } from '../errors';
import { formatLe } from '../money';
import { PaymentSession, type PaymentSnapshot } from '../payments';
import { detectOperator, formatLocalPhone, OPERATOR_NAME, suggestedWallet, tryNormalizeSlPhone, walletMismatch } from '../phone';
import type { CreatePaymentBody, GatewayCode, Payment, PaymentMethod, PaymentMethods } from '../types';
import { useT } from './i18n';
import { Banner, Body, Button, Card, Choice, Field, H2, Money, Muted, Pill, Stack, Strong } from './primitives';
import { useApiQuery } from './query';
import { useSession } from './session';
import { colors, space } from './theme';

export type MethodKind = 'cash' | 'wallet' | 'mobile_money';

const MOBILE: GatewayCode[] = ['orange_money', 'afrimoney', 'qmoney', 'monime'];

export function isGateway(m: PaymentMethod | null | undefined): m is GatewayCode {
  return !!m && (MOBILE as string[]).includes(m);
}

/** Loads /payments/methods for a number: available wallets, detected operator and suggested wallet. */
export function usePaymentMethods(msisdn: string | null) {
  const { api } = useSession();
  const e164 = tryNormalizeSlPhone(msisdn);
  return useApiQuery<PaymentMethods>(`methods:${e164 ?? 'none'}`, () => api.payments.methods(e164 ?? undefined), { cache: true });
}

/**
 * Cash / FixAm wallet / Orange Money / Afrimoney / QMoney / Monime.
 * Marks the wallet that matches the SIM and warns when the chosen wallet does not match the number's network.
 */
export function MethodPicker({
  methods, value, onChange, msisdn, onMsisdnChange, allow, walletBalanceMinor, amountMinor,
}: {
  methods: PaymentMethods | undefined;
  value: PaymentMethod | null;
  onChange: (m: PaymentMethod) => void;
  msisdn: string;
  onMsisdnChange: (v: string) => void;
  allow: MethodKind[];
  walletBalanceMinor?: number;
  amountMinor?: number;
}) {
  const t = useT();
  const available = (methods?.methods ?? []).filter((m) => allow.includes(m.type));
  const options: PaymentMethod[] = available.length
    ? available.map((m) => m.code)
    : ([...(allow.includes('cash') ? ['cash'] : []), ...(allow.includes('wallet') ? ['wallet'] : []), ...(allow.includes('mobile_money') ? MOBILE : [])] as PaymentMethod[]);
  const suggested = methods?.suggested ?? (tryNormalizeSlPhone(msisdn) ? suggestedWallet(msisdn) : null);
  const mismatch = isGateway(value) ? walletMismatch(value, msisdn) : null;
  const e164 = tryNormalizeSlPhone(msisdn);
  const op = e164 ? detectOperator(e164) : 'unknown';
  const lowWallet = value === 'wallet' && walletBalanceMinor != null && amountMinor != null && walletBalanceMinor < amountMinor;

  return (
    <Stack gap={space.sm}>
      {options.map((code) => {
        const m = available.find((x) => x.code === code);
        const sub =
          code === 'wallet' && walletBalanceMinor != null
            ? t('method.walletBalance', { amount: formatLe(walletBalanceMinor) })
            : code === 'cash'
              ? t('method.cashHint')
              : null;
        return (
          <Choice
            key={code}
            testID={`method-${code}`}
            title={t.dyn(`method.${code}`, m?.name ?? code)}
            subtitle={sub}
            selected={value === code}
            onPress={() => onChange(code)}
            right={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {code === suggested ? <Pill tone="brand" label={t('method.suggested')} /> : null}
                {m?.sandbox ? <Pill tone="neutral" label="test" /> : null}
              </View>
            }
          />
        );
      })}
      {isGateway(value) ? (
        <Field
          label={t('method.payNumber')}
          value={msisdn}
          onChangeText={onMsisdnChange}
          keyboardType="phone-pad"
          inputMode="tel"
          placeholder="076 123 456"
          hint={e164 ? `${formatLocalPhone(e164)} · ${OPERATOR_NAME[op]}` : undefined}
        />
      ) : null}
      {mismatch && isGateway(value) ? (
        <Banner
          tone="warn"
          icon="⚠️"
          testID="wallet-mismatch"
          title={t('method.mismatch', { number: formatLocalPhone(msisdn), network: OPERATOR_NAME[op], wallet: t.dyn(`method.${value}`, value) })}
          action={t('method.useSuggested', { wallet: t.dyn(`method.${mismatch}`, mismatch) })}
          onAction={() => onChange(mismatch)}
        />
      ) : null}
      {lowWallet ? <Banner tone="warn" title={t('method.lowWallet')} /> : null}
    </Stack>
  );
}

/** Text for failure_reason codes, translated. */
export function useFailureText() {
  const t = useT();
  return (reason: string | null | undefined) => t.dyn(`pay.reason.${reason ?? 'unknown'}`, (reason ?? 'unknown').replace(/_/g, ' '));
}

/**
 * The full mobile money flow:
 * choose wallet -> POST /payments (Idempotency-Key reused on retry) -> "Check your phone" -> poll every 3 s
 * -> succeeded / failed (reason, retry, other wallet) / expired. Sandbox shows "Simulate approval".
 */
export function PaymentFlow({
  buildBody, amountMinor, initialGateway, initialMsisdn, storeKey, allowWallet, walletBalanceMinor, autoStart, onSuccess, successLabel, title,
}: {
  buildBody: (gateway: GatewayCode | 'wallet', msisdn: string) => CreatePaymentBody;
  amountMinor?: number;
  initialGateway?: GatewayCode | 'wallet' | null;
  initialMsisdn: string;
  storeKey: string;
  allowWallet?: boolean;
  walletBalanceMinor?: number;
  autoStart?: boolean;
  onSuccess: (p: Payment) => void;
  successLabel?: string;
  title?: string;
}) {
  const t = useT();
  const failureText = useFailureText();
  const { api, kv } = useSession();
  const [gateway, setGateway] = useState<PaymentMethod | null>(initialGateway ?? null);
  const [msisdn, setMsisdn] = useState(formatLocalPhone(initialMsisdn));
  const [snap, setSnap] = useState<PaymentSnapshot | null>(null);
  const [choosing, setChoosing] = useState(!(autoStart && initialGateway));
  const methods = usePaymentMethods(msisdn);
  const sandbox = (methods.data?.methods ?? []).some((m) => m.sandbox);
  const sessionRef = useRef<PaymentSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new PaymentSession(api, { store: kv, storeKey, onChange: setSnap });
  const session = sessionRef.current;

  // Pre-select the wallet that matches the SIM when the caller did not choose one.
  useEffect(() => {
    if (!gateway && methods.data?.suggested) setGateway(methods.data.suggested);
  }, [gateway, methods.data?.suggested]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const resumed = await session.resumeSaved();
      if (!alive) return;
      if (resumed) setChoosing(false);
      else if (autoStart && initialGateway) void session.start(buildBody(initialGateway, initialMsisdn));
    })();
    return () => {
      alive = false;
      session.stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (snap?.phase === 'succeeded' && snap.payment) onSuccess(snap.payment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.phase]);

  const canPay = gateway && gateway !== 'cash' && (gateway === 'wallet' || !!tryNormalizeSlPhone(msisdn));
  const pay = () => {
    if (!canPay) return;
    setChoosing(false);
    void session.start(buildBody(gateway as GatewayCode | 'wallet', tryNormalizeSlPhone(msisdn) ?? msisdn));
  };
  const amount = snap?.payment?.amount_minor ?? amountMinor;

  if (choosing || !snap || snap.phase === 'idle') {
    return (
      <Stack>
        {title ? <H2>{title}</H2> : null}
        {amount != null ? (
          <Card>
            <Muted>{t('common.amount')}</Muted>
            <Money minor={amount} size="hero" />
          </Card>
        ) : null}
        <MethodPicker
          methods={methods.data}
          value={gateway}
          onChange={setGateway}
          msisdn={msisdn}
          onMsisdnChange={setMsisdn}
          allow={allowWallet ? ['wallet', 'mobile_money'] : ['mobile_money']}
          walletBalanceMinor={walletBalanceMinor}
          amountMinor={amount}
        />
        <Button title={amount != null ? t('pay.payAmount', { amount: formatLe(amount) }) : t('common.continue')} onPress={pay} disabled={!canPay} testID="pay-button" />
        {sandbox ? <Muted center>{t('pay.sandbox')}</Muted> : null}
      </Stack>
    );
  }

  const p = snap.payment;
  const backToChoose = async () => {
    await session.reset();
    setChoosing(true);
  };

  switch (snap.phase) {
    case 'creating':
      return (
        <Card style={{ alignItems: 'center', paddingVertical: space.xxl }}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Strong>{t('pay.starting')}</Strong>
          {snap.attempt > 0 ? <Muted center>{t('pay.retrySafe')}</Muted> : null}
        </Card>
      );
    case 'waiting':
      return (
        <Stack>
          <Card tone="info" style={{ alignItems: 'center', paddingVertical: space.xl }}>
            <Text style={{ fontSize: 64 }}>📲</Text>
            <H2 center color={colors.info}>{t('pay.checkPhone')}</H2>
            <Body center testID="customer-action">{p?.customer_action?.message ?? t('pay.waiting')}</Body>
            {p?.customer_action?.paymentCode ? (
              <View style={{ alignItems: 'center' }}>
                <Muted>{t('pay.paymentCode')}</Muted>
                <Text selectable style={{ fontSize: 40, fontWeight: '900', letterSpacing: 4, color: colors.text }}>{p.customer_action.paymentCode}</Text>
              </View>
            ) : null}
            {p?.customer_action?.ussdCode ? <Strong>{t('pay.dial', { code: p.customer_action.ussdCode })}</Strong> : null}
            {amount != null ? <Money minor={amount} size="title" /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <ActivityIndicator color={colors.info} />
              <Muted>{t('pay.waiting')}</Muted>
            </View>
          </Card>
          {snap.offline ? <Banner tone="warn" icon="📶" title={t('pay.offlineWaiting')} /> : null}
          {sandbox ? (
            <Card tone="accent">
              <Muted>{t('pay.sandbox')}</Muted>
              <Button title={t('pay.simulate')} variant="accent" onPress={() => session.simulate('succeeded').then(() => {}).catch(() => {})} testID="simulate-approve" />
              <Button title={t('pay.simulateFail')} variant="secondary" small onPress={() => session.simulate('failed').then(() => {}).catch(() => {})} />
            </Card>
          ) : null}
          <Button title={t('pay.otherWallet')} variant="ghost" onPress={backToChoose} />
        </Stack>
      );
    case 'succeeded':
      return (
        <Card tone="success" style={{ alignItems: 'center', paddingVertical: space.xl }}>
          <Text style={{ fontSize: 64 }}>✅</Text>
          <H2 center color={colors.success}>{t('pay.succeeded')}</H2>
          {amount != null ? <Money minor={amount} size="title" /> : null}
          {successLabel ? <Body center>{successLabel}</Body> : null}
        </Card>
      );
    case 'failed':
    case 'expired':
      return (
        <Stack>
          <Card tone="danger" style={{ alignItems: 'center', paddingVertical: space.xl }}>
            <Text style={{ fontSize: 64 }}>{snap.phase === 'expired' ? '⏱️' : '❌'}</Text>
            <H2 center color={colors.danger}>{snap.phase === 'expired' ? t('pay.expired') : t('pay.failed')}</H2>
            <Body center>{snap.phase === 'expired' ? t('pay.expiredBody') : failureText(p?.failure_reason)}</Body>
          </Card>
          <Button title={t('pay.retry')} onPress={() => session.retry().then(() => {})} />
          <Button title={t('pay.otherWallet')} variant="secondary" onPress={backToChoose} />
        </Stack>
      );
    case 'error':
    default:
      return (
        <Stack>
          <Banner tone="danger" icon="⚠️" title={t('pay.couldNotStart')} body={errorMessage(snap.error, t('common.offline'))} />
          {snap.suggestedGateway ? (
            <Button
              title={t('method.useSuggested', { wallet: t.dyn(`method.${snap.suggestedGateway}`, snap.suggestedGateway) })}
              onPress={async () => {
                const g = snap.suggestedGateway!;
                setGateway(g);
                await session.reset();
                void session.start(buildBody(g, tryNormalizeSlPhone(msisdn) ?? msisdn));
              }}
            />
          ) : (
            <Button title={t('pay.retry')} onPress={() => session.retry().then(() => {})} />
          )}
          <Muted center>{t('pay.retrySafe')}</Muted>
          <Button title={t('pay.otherWallet')} variant="secondary" onPress={backToChoose} />
        </Stack>
      );
  }
}
