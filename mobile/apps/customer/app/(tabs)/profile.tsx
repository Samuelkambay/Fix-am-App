import { useRouter } from 'expo-router';
import { useState } from 'react';
import { errorMessage, formatLocalPhone } from '@fixam/shared';
import { Banner, Button, Card, Field, KV, LanguageToggle, Muted, Screen, SectionTitle, useSession, useT } from '@fixam/shared/ui';
import { API_URL } from '../../src/platform';

export default function Profile() {
  const t = useT();
  const router = useRouter();
  const { api, user, updateUser, logout } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setMsg(null);
    try {
      updateUser(await api.auth.updateMe({ name: name.trim() }));
      setMsg({ ok: true, text: t('common.saved') });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, t('common.offline')) });
    }
  };

  return (
    <Screen>
      <Card>
        <KV k={t('profile.phone')} v={formatLocalPhone(user?.phone)} bold />
      </Card>
      <Field label={t('profile.name')} value={name} onChangeText={setName} autoCapitalize="words" />
      <Button title={t('common.save')} onPress={save} disabled={name.trim().length < 2 || name.trim() === user?.name} />
      {msg ? <Banner tone={msg.ok ? 'success' : 'danger'} title={msg.text} /> : null}
      <SectionTitle>{t('common.language')}</SectionTitle>
      <LanguageToggle />
      <SectionTitle> </SectionTitle>
      <Button
        title={t('common.logout')}
        variant="danger"
        onPress={async () => {
          await logout();
          router.replace('/login');
        }}
      />
      <Muted center>
        {t('profile.apiUrl')}: {API_URL}
      </Muted>
    </Screen>
  );
}
