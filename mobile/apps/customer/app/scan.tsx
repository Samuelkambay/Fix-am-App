import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Platform, View } from 'react-native';
import { Banner, Body, Button, colors, Screen, useT } from '@fixam/shared/ui';

/** Scans the QR on a handyman's badge card. The QR holds the FXB- code (or a link ending in it). */
export default function Scan() {
  const t = useT();
  const router = useRouter();
  const [perm, requestPerm] = useCameraPermissions();
  const done = useRef(false);

  if (Platform.OS === 'web' || (perm && !perm.granted && !perm.canAskAgain)) {
    return (
      <Screen>
        <Banner tone="info" title={t('verify.cameraDenied')} action={t('common.back')} onAction={() => router.back()} />
      </Screen>
    );
  }
  if (!perm?.granted) {
    return (
      <Screen>
        <Body>{t('verify.scanHint')}</Body>
        <Button title={t('verify.scan')} onPress={requestPerm} />
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.text }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return;
          const m = /FXB-[A-Z0-9]+/i.exec(data);
          if (!m) return;
          done.current = true;
          router.replace({ pathname: '/(tabs)/verify', params: { code: m[0].toUpperCase() } });
        }}
      />
      <View style={{ padding: 16, backgroundColor: colors.card }}>
        <Body center>{t('verify.scanHint')}</Body>
      </View>
    </View>
  );
}
