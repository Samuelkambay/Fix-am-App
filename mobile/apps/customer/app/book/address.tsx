import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { formatLocalPhone, tryNormalizeSlPhone } from '@fixam/shared';
import { Banner, Button, Field, Muted, Screen, Stack, useSession, useT } from '@fixam/shared/ui';
import { useDraft } from '../../src/state';

/** Addresses in Sierra Leone are landmark-based: the landmark is required, GPS is a bonus. */
export default function AddressScreen() {
  const t = useT();
  const router = useRouter();
  const { user } = useSession();
  const { draft, update } = useDraft();
  const a = draft.address;
  const [area, setArea] = useState(a?.area ?? '');
  const [landmark, setLandmark] = useState(a?.landmark ?? '');
  const [street, setStreet] = useState(a?.street ?? '');
  const [phone, setPhone] = useState(formatLocalPhone(a?.contactPhone ?? user?.phone ?? ''));
  const [notes, setNotes] = useState(draft.notes);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(a?.lat != null && a?.lng != null ? { lat: a.lat, lng: a.lng } : null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState(false);
  const [touched, setTouched] = useState(false);

  const addPin = async () => {
    setGpsBusy(true);
    setGpsError(false);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') throw new Error('denied');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = pos.coords;
      // The API only accepts points inside Sierra Leone.
      if (lat < 6.8 || lat > 10.1 || lng < -13.4 || lng > -10.2) throw new Error('outside');
      setPin({ lat, lng });
    } catch {
      setGpsError(true);
    } finally {
      setGpsBusy(false);
    }
  };

  const areaOk = area.trim().length >= 2;
  const landmarkOk = landmark.trim().length >= 2;
  const phoneOk = !phone.trim() || !!tryNormalizeSlPhone(phone);

  const next = () => {
    setTouched(true);
    if (!areaOk || !landmarkOk || !phoneOk) return;
    update({
      address: {
        area: area.trim(),
        landmark: landmark.trim(),
        street: street.trim() || undefined,
        lat: pin?.lat,
        lng: pin?.lng,
        contactPhone: tryNormalizeSlPhone(phone) ?? undefined,
      },
      notes: notes.trim(),
    });
    router.push('/book/payment');
  };

  return (
    <Screen footer={<Button title={t('common.continue')} onPress={next} testID="address-next" />}>
      <Stack>
        <Field label={t('address.area')} value={area} onChangeText={setArea} placeholder={t('address.areaPlaceholder')} error={touched && !areaOk ? t('address.areaRequired') : null} testID="area-input" />
        <Field
          label={`${t('address.landmark')} *`}
          value={landmark}
          onChangeText={setLandmark}
          placeholder={t('address.landmarkPlaceholder')}
          hint={t('address.landmarkHint')}
          error={touched && !landmarkOk ? t('address.landmarkRequired') : null}
          multiline
          testID="landmark-input"
        />
        <Field label={t('address.street')} optional optionalText={t('common.optional')} value={street} onChangeText={setStreet} />
        {pin ? (
          <Banner tone="success" icon="📍" title={t('address.gpsAdded')} body={`${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`} action={t('address.gpsRemove')} onAction={() => setPin(null)} />
        ) : (
          <Button title={`📍 ${t('address.gps')} (${t('common.optional')})`} variant="secondary" onPress={addPin} loading={gpsBusy} />
        )}
        {gpsError ? <Muted>{t('address.gpsFailed')}</Muted> : null}
        <Field label={t('address.contactPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" inputMode="tel" error={!phoneOk ? t('login.phoneInvalid') : null} />
        <Field label={t('address.notes')} optional optionalText={t('common.optional')} value={notes} onChangeText={setNotes} multiline />
      </Stack>
    </Screen>
  );
}
