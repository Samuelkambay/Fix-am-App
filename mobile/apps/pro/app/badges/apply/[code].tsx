import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { errorMessage, type BadgeDocument, type UploadContentType } from '@fixam/shared';
import { Banner, badgeIcon, Body, Button, Card, Field, H2, Loading, Muted, Pill, Row, Screen, space, Strong, useApiQuery, useSession, useT } from '@fixam/shared/ui';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: UploadContentType[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

type Slot = { state: 'empty' } | { state: 'uploading'; name: string } | { state: 'done'; name: string; url: string } | { state: 'error'; message: string };

function guessType(name: string | undefined | null, mime: string | undefined | null): UploadContentType | null {
  const m = (mime ?? '').toLowerCase();
  if ((ALLOWED as string[]).includes(m)) return m as UploadContentType;
  if (m === 'image/jpg') return 'image/jpeg';
  const ext = (name ?? '').toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  return null;
}

/** Reads a picked file into a Blob (works for file://, content://, blob: and data: URIs, and web File objects). */
async function toBlob(uri: string, file?: Blob | null): Promise<Blob> {
  if (file) return file;
  const res = await fetch(uri);
  return res.blob();
}

export default function ApplyBadge() {
  const t = useT();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { api } = useSession();
  const defs = useApiQuery('badges:defs', () => api.badges.definitions(), { cache: true });
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const def = defs.data?.find((d) => d.code === code);
  if (!def) return <Loading />;

  const setSlot = (type: string, s: Slot) => setSlots((cur) => ({ ...cur, [type]: s }));

  const upload = async (type: string, name: string, uri: string, mime: string | null | undefined, size: number | null | undefined, file?: Blob | null) => {
    const ct = guessType(name, mime);
    if (!ct) return setSlot(type, { state: 'error', message: 'JPEG, PNG, WebP or PDF' });
    if (size && size > MAX_BYTES) return setSlot(type, { state: 'error', message: t('badges.tooBig') });
    setSlot(type, { state: 'uploading', name });
    try {
      const blob = await toBlob(uri, file);
      if (blob.size > MAX_BYTES) return setSlot(type, { state: 'error', message: t('badges.tooBig') });
      const res = await api.uploads.upload(blob, ct);
      setSlot(type, { state: 'done', name, url: res.url });
    } catch (e) {
      setSlot(type, { state: 'error', message: errorMessage(e, t('common.offline')) });
    }
  };

  const pickImage = async (type: string, camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setSlot(type, { state: 'error', message: t('badges.permission') });
    // Compressed JPEG keeps uploads small on 2G/3G; ID text stays readable at this quality.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false, exif: false };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    await upload(type, a.fileName ?? `${type}.jpg`, a.uri, a.mimeType ?? 'image/jpeg', a.fileSize, a.file ?? null);
  };

  const pickPdf = async (type: string) => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    await upload(type, a.name, a.uri, a.mimeType, a.size, a.file ?? null);
  };

  const docs: BadgeDocument[] = def.required_documents.flatMap((type) => {
    const s = slots[type];
    return s?.state === 'done' ? [{ type, url: s.url, ...(type === 'id_document' && number.trim() ? { number: number.trim() } : {}) }] : [];
  });
  const ready = docs.length === def.required_documents.length && def.required_documents.length > 0;

  const submit = async () => {
    setError(null);
    try {
      await api.badges.apply(def.code, docs);
      setSubmitted(true);
    } catch (e) {
      setError(errorMessage(e, t('common.offline')));
    }
  };

  return (
    <Screen footer={submitted ? <Button title={t('common.done')} variant="pro" onPress={() => router.back()} /> : <Button title={t('badges.submit')} variant="pro" disabled={!ready} onPress={submit} />}>
      <H2>
        {badgeIcon(def.code)} {t.dyn(`badge.${def.code}`, def.name)}
      </H2>
      {def.description ? <Body>{def.description}</Body> : null}
      {submitted ? <Banner tone="success" icon="📨" title={t('badges.submitted')} /> : null}
      {def.required_documents.map((type) => {
        const s = slots[type] ?? { state: 'empty' };
        return (
          <Card key={type}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Strong style={{ flex: 1 }}>{t.dyn(`doc.${type}`, t('doc.other'))}</Strong>
              {s.state === 'done' ? <Pill tone="success" label={`✓ ${t('badges.uploaded')}`} /> : s.state === 'uploading' ? <Pill tone="info" label={t('badges.uploading')} /> : null}
            </Row>
            {s.state === 'done' || s.state === 'uploading' ? <Muted>{s.name}</Muted> : null}
            {s.state === 'error' ? <Banner tone="danger" title={s.message} /> : null}
            <View style={{ gap: space.sm }}>
              <Button small variant="secondary" title={`📷 ${t('badges.takePhoto')}`} onPress={() => pickImage(type, true)} disabled={s.state === 'uploading'} />
              <Button small variant="secondary" title={`🖼️ ${t('badges.pickPhoto')}`} onPress={() => pickImage(type, false)} disabled={s.state === 'uploading'} />
              <Button small variant="secondary" title={`📄 ${t('badges.pickPdf')}`} onPress={() => pickPdf(type)} disabled={s.state === 'uploading'} />
            </View>
            {type === 'id_document' ? <Field label={t('badges.docNumber')} optional optionalText={t('common.optional')} value={number} onChangeText={setNumber} autoCapitalize="characters" maxLength={60} /> : null}
          </Card>
        );
      })}
      {!ready && !submitted ? <Muted>{t('badges.missingDocs')}</Muted> : null}
      {error ? <Banner tone="danger" title={error} /> : null}
    </Screen>
  );
}
