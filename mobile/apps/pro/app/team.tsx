import { useState } from 'react';
import { View } from 'react-native';
import { errorMessage, formatLocalPhone, tryNormalizeSlPhone } from '@fixam/shared';
import { Banner, Button, Card, EmptyState, Field, Muted, Pill, QueryView, Row, Screen, SectionTitle, space, Strong, useApiQuery, useSession, useT } from '@fixam/shared/ui';

export default function Team() {
  const t = useT();
  const { api } = useSession();
  const q = useApiQuery('team', () => api.providers.servicemen(), { cache: true });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const add = async () => {
    setMsg(null);
    try {
      await api.providers.addServiceman({ name: name.trim(), phone: tryNormalizeSlPhone(phone)! });
      setMsg({ ok: true, text: t('team.added', { name: name.trim() }) });
      setName('');
      setPhone('');
      await q.reload();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, t('common.offline')) });
    }
  };

  return (
    <Screen onRefresh={q.reload} refreshing={q.refreshing}>
      <QueryView q={q}>
        {(rows) =>
          rows.length ? (
            <View style={{ gap: space.sm }}>
              {rows.map((s) => (
                <Card key={s.id}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 19 }}>{s.name ?? '—'}</Strong>
                      <Muted>
                        {formatLocalPhone(s.phone)} · {t('team.activeJobs', { count: s.active_jobs })}
                      </Muted>
                    </View>
                    <Pill tone={s.active ? 'success' : 'neutral'} label={s.active ? t('team.active') : t('team.inactive')} />
                  </Row>
                  <Button
                    small
                    variant={s.active ? 'ghost' : 'secondary'}
                    title={s.active ? t('team.deactivate') : t('team.activate')}
                    onPress={async () => {
                      try {
                        await api.providers.setServicemanActive(s.id, !s.active);
                        await q.reload();
                      } catch (e) {
                        setMsg({ ok: false, text: errorMessage(e, t('common.offline')) });
                      }
                    }}
                  />
                </Card>
              ))}
            </View>
          ) : (
            <EmptyState icon="👷" title={t('team.empty')} />
          )
        }
      </QueryView>
      <SectionTitle>{t('team.add')}</SectionTitle>
      <Card>
        <Muted>{t('team.addHint')}</Muted>
        <Field label={t('common.name')} value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label={t('common.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="078 123 456" error={phone && !tryNormalizeSlPhone(phone) ? t('login.phoneInvalid') : null} />
        <Button title={t('team.add')} variant="pro" disabled={name.trim().length < 2 || !tryNormalizeSlPhone(phone)} onPress={add} />
      </Card>
      {msg ? <Banner tone={msg.ok ? 'success' : 'danger'} title={msg.text} /> : null}
    </Screen>
  );
}
