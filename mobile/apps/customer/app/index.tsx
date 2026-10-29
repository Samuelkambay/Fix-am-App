import { Redirect } from 'expo-router';
import { Loading, useSession } from '@fixam/shared/ui';

export default function Index() {
  const { ready, user } = useSession();
  if (!ready) return <Loading />;
  return <Redirect href={user ? '/(tabs)' : '/login'} />;
}
