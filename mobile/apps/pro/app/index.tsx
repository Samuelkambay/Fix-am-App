import { Redirect, useRouter } from 'expo-router';
import { Banner, Button, Loading, Screen, useSession, useT } from '@fixam/shared/ui';

/** One app, two audiences: the UI switches on user.role. */
export default function Index() {
  const t = useT();
  const router = useRouter();
  const { ready, user, logout } = useSession();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  switch (user.role) {
    case 'provider':
      return <Redirect href="/(provider)" />;
    case 'serviceman':
      return <Redirect href="/(serviceman)" />;
    case 'customer':
      return <Redirect href="/register" />;
    default:
      return (
        <Screen>
          <Banner tone="info" title={t('pro.adminAccount')} />
          <Button
            title={t('common.logout')}
            variant="secondary"
            onPress={async () => {
              await logout();
              router.replace('/login');
            }}
          />
        </Screen>
      );
  }
}
