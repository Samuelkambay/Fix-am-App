import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders, colors, useT } from '@fixam/shared/ui';
import { api, kv } from '../src/platform';

function Nav() {
  const t = useT();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.pro },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '800', fontSize: 20 },
        contentStyle: { backgroundColor: colors.bg },
        headerBackTitle: t('common.back'),
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ title: t('register.title') }} />
      <Stack.Screen name="(provider)" options={{ headerShown: false }} />
      <Stack.Screen name="(serviceman)" options={{ headerShown: false }} />
      <Stack.Screen name="job/[id]" options={{ title: t('jobs.title') }} />
      <Stack.Screen name="team" options={{ title: t('team.title') }} />
      <Stack.Screen name="badges/index" options={{ title: t('badges.title') }} />
      <Stack.Screen name="badges/apply/[code]" options={{ title: t('badges.apply') }} />
      <Stack.Screen name="plans" options={{ title: t('plans.title') }} />
      <Stack.Screen name="subscribe/[planId]" options={{ title: t('plans.subscribe') }} />
      <Stack.Screen name="withdraw" options={{ title: t('earn.withdraw') }} />
      <Stack.Screen name="pay-commission" options={{ title: t('earn.payOwed') }} />
      <Stack.Screen name="profile" options={{ title: t('profile.title') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders api={api} kv={kv}>
      <StatusBar style="light" />
      <Nav />
    </AppProviders>
  );
}
