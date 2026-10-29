import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, colors, ListRow, Screen, useSession, useT } from '@fixam/shared/ui';

export default function More() {
  const t = useT();
  const router = useRouter();
  const { logout } = useSession();
  const items: { title: string; icon: string; href: '/badges' | '/team' | '/plans' | '/profile' }[] = [
    { title: t('badges.title'), icon: '🪪', href: '/badges' },
    { title: t('team.title'), icon: '👷', href: '/team' },
    { title: t('plans.title'), icon: '📈', href: '/plans' },
    { title: t('profile.title'), icon: '👤', href: '/profile' },
  ];
  return (
    <Screen>
      <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
        {items.map((i) => (
          <ListRow key={i.href} title={`${i.icon}  ${i.title}`} onPress={() => router.push(i.href)} />
        ))}
      </View>
      <Button title={t('common.logout')} variant="danger" onPress={async () => { await logout(); router.replace('/login'); }} />
    </Screen>
  );
}
