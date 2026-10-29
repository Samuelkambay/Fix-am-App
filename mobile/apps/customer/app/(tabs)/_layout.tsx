import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors, Loading, useSession, useT } from '@fixam/shared/ui';

const icon = (glyph: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 24, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const t = useT();
  const { ready, user } = useSession();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.brand },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '800', fontSize: 20 },
        tabBarActiveTintColor: colors.brandDark,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '700' },
        tabBarStyle: { height: 68, paddingBottom: 8, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'FixAm', tabBarLabel: t('home.categories'), tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="bookings" options={{ title: t('bookings.title'), tabBarLabel: t('bookings.tab'), tabBarIcon: icon('📋') }} />
      <Tabs.Screen name="verify" options={{ title: t('verify.title'), tabBarLabel: t('verify.check'), tabBarIcon: icon('🛡️') }} />
      <Tabs.Screen name="wallet" options={{ title: t('wallet.title'), tabBarIcon: icon('👛') }} />
      <Tabs.Screen name="profile" options={{ title: t('profile.title'), tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
