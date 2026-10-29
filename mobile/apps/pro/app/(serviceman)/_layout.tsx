import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors, Loading, useSession, useT } from '@fixam/shared/ui';

const icon = (glyph: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 24, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
  };

/** Team members only see jobs assigned to them. */
export default function ServicemanTabs() {
  const t = useT();
  const { ready, user } = useSession();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== 'serviceman') return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.pro },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '800', fontSize: 20 },
        tabBarActiveTintColor: colors.pro,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '700' },
        tabBarStyle: { height: 68, paddingBottom: 8, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('sman.title'), tabBarIcon: icon('🧰') }} />
      <Tabs.Screen name="me" options={{ title: t('profile.title'), tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
