import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { formatLocalPhone, tryNormalizeSlPhone, walletMismatch, type PaymentMethod } from '@fixam/shared';
import { Button, isGateway, Loading, MethodPicker, Screen, usePaymentMethods, useApiQuery, useSession, useT } from '@fixam/shared/ui';
import { useDraft } from '../../src/state';

export default function PaymentChoice() {
  const t = useT();
  const router = useRouter();
  const { api, user } = useSession();
  const { draft, update } = useDraft();
  const [msisdn, setMsisdn] = useState(formatLocalPhone(draft.msisdn || user?.phone || ''));
  const [method, setMethod] = useState<PaymentMethod | null>(draft.paymentMethod);
  const methods = usePaymentMethods(msisdn);
  const wallet = useApiQuery('wallet:customer', () => api.wallet.customer({ limit: 1 }), { cache: true });

  // Pre-select the wallet suggested for the user's SIM.
  useEffect(() => {
    if (!method && methods.data?.suggested) setMethod(methods.data.suggested);
  }, [method, methods.data?.suggested]);

  if (methods.loading && !methods.data) return <Loading />;
  const amount = draft.quote?.total_minor;
  const okNumber = !isGateway(method) || (!!tryNormalizeSlPhone(msisdn) && !walletMismatch(method, msisdn));
  const okWallet = method !== 'wallet' || (wallet.data?.balance_minor ?? 0) >= (amount ?? 0);

  return (
    <Screen
      footer={
        <Button
          title={t('common.continue')}
          disabled={!method || !okNumber || !okWallet}
          testID="payment-next"
          onPress={() => {
            update({ paymentMethod: method, msisdn: tryNormalizeSlPhone(msisdn) ?? '' });
            router.push('/book/confirm');
          }}
        />
      }
    >
      <MethodPicker
        methods={methods.data}
        value={method}
        onChange={setMethod}
        msisdn={msisdn}
        onMsisdnChange={setMsisdn}
        allow={['cash', 'wallet', 'mobile_money']}
        walletBalanceMinor={wallet.data?.balance_minor}
        amountMinor={amount}
      />
    </Screen>
  );
}
