import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import type { GatewayCode } from '@fixam/shared';
import { Button, Card, Loading, Muted, PaymentFlow, QueryView, Screen, Strong, useApiQuery, useSession, useT } from '@fixam/shared/ui';

/** Mobile money (or wallet) payment for a booking. Retry-safe: the Idempotency-Key is reused until a definitive result. */
export default function PayBooking() {
  const t = useT();
  const router = useRouter();
  const { bookingId, gateway, msisdn, auto } = useLocalSearchParams<{ bookingId: string; gateway?: string; msisdn?: string; auto?: string }>();
  const { api, user } = useSession();
  const booking = useApiQuery(`booking:${bookingId}`, () => api.bookings.get(bookingId));
  const wallet = useApiQuery('wallet:customer', () => api.wallet.customer({ limit: 1 }), { cache: true });
  const [paid, setPaid] = useState(false);

  if (booking.loading && !booking.data) return <Loading />;
  return (
    <Screen
      footer={paid ? <Button title={t('common.continue')} onPress={() => router.replace(`/booking/${bookingId}`)} testID="after-pay" /> : undefined}
    >
      <QueryView q={booking}>
        {(b) => (
          <>
            <Card>
              <Muted>{t('bookings.code', { code: b.code })}</Muted>
              <Strong style={{ fontSize: 19 }}>{b.service_name}</Strong>
            </Card>
            <PaymentFlow
              storeKey={`pay:booking:${b.id}`}
              amountMinor={b.total_minor}
              initialGateway={(gateway as GatewayCode | 'wallet' | undefined) ?? (b.payment_method !== 'cash' ? (b.payment_method as GatewayCode | 'wallet') : null)}
              initialMsisdn={msisdn || user?.phone || ''}
              autoStart={auto === '1'}
              allowWallet
              walletBalanceMinor={wallet.data?.balance_minor}
              buildBody={(g, m) => ({ purpose: 'booking', bookingId: b.id, gateway: g, msisdn: g === 'wallet' ? undefined : m })}
              onSuccess={() => setPaid(true)}
            />
          </>
        )}
      </QueryView>
    </Screen>
  );
}
