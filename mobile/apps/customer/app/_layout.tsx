import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders, colors, useT } from '@fixam/shared/ui';
import { api, kv } from '../src/platform';
import { DraftProvider, ZoneProvider } from '../src/state';

function Nav() {
  const t = useT();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.brand },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '800', fontSize: 20 },
        contentStyle: { backgroundColor: colors.bg },
        headerBackTitle: t('common.back'),
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="zone" options={{ title: t('zone.pick'), presentation: 'modal' }} />
      <Stack.Screen name="category/[id]" options={{ title: t('home.categories') }} />
      <Stack.Screen name="service/[id]" options={{ title: t('book.chooseTime') }} />
      <Stack.Screen name="book/providers" options={{ title: t('providers.title') }} />
      <Stack.Screen name="provider/[id]" options={{ title: t('providers.profile') }} />
      <Stack.Screen name="book/address" options={{ title: t('address.title') }} />
      <Stack.Screen name="book/payment" options={{ title: t('method.title') }} />
      <Stack.Screen name="book/confirm" options={{ title: t('confirm.title') }} />
      <Stack.Screen name="pay/[bookingId]" options={{ title: t('pay.title') }} />
      <Stack.Screen name="booking/[id]" options={{ title: t('bookings.title') }} />
      <Stack.Screen name="topup" options={{ title: t('wallet.topUp') }} />
      <Stack.Screen name="scan" options={{ title: t('verify.scan') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders api={api} kv={kv}>
      <ZoneProvider>
        <DraftProvider>
          <StatusBar style="light" />
          <Nav />
        </DraftProvider>
      </ZoneProvider>
    </AppProviders>
  );
}
