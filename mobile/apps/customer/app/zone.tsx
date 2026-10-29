import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Banner, Button, Choice, QueryView, Screen, SectionTitle, space, useApiQuery, useSession, useT } from '@fixam/shared/ui';
import { useZone } from '../src/state';

export default function ZonePicker() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const { zone, setZone, detect, status } = useZone();
  const zones = useApiQuery('zones', () => api.zones.list(), { cache: true });

  return (
    <Screen>
      <Button
        title={status === 'detecting' ? t('zone.detecting') : `📍 ${t('zone.useGps')}`}
        loading={status === 'detecting'}
        onPress={async () => {
          if (await detect()) router.back();
        }}
      />
      {status === 'outside' ? <Banner tone="warn" title={t('zone.outside')} /> : null}
      {status === 'denied' ? <Banner tone="info" title={t('zone.gpsDenied')} /> : null}
      <SectionTitle>{t('zone.pick')}</SectionTitle>
      <QueryView q={zones}>
        {(rows) => (
          <View style={{ gap: space.sm }}>
            {rows.map((z) => (
              <Choice
                key={z.id}
                title={z.name}
                subtitle={z.district}
                selected={zone?.id === z.id}
                onPress={() => {
                  setZone(z);
                  router.back();
                }}
              />
            ))}
          </View>
        )}
      </QueryView>
    </Screen>
  );
}
