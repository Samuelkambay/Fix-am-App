import { useRouter } from 'expo-router';
import { LoginFlow } from '@fixam/shared/ui';

export default function Login() {
  const router = useRouter();
  return <LoginFlow variant="pro" onDone={() => router.replace('/')} />;
}
