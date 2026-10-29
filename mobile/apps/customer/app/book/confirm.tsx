import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ApiError, errorMessage, formatDateTime, formatLocalPhone } from '@fixam/shared';
import { Banner, Button, Card, KV, Screen, SectionTitle, Strong, useSession, useT } from '@fixam/shared/ui';
import { QuoteCard } from '../../src/components';
import { quoteDraft, useDraft } from '../../src/state';

export default function Confirm() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const { draft, update, reset } = useDraft();
  const [error, setError] = useState<string | null>(null);
  const [providerBlocked, setProviderBlocked] = useState(false);
  const { quote, service, address, paymentMethod } = draft;

  if (!quote || !service || !address || !paymentMethod) {
    return (
      <Screen>
        <Banner tone="warn" title={t('book.priceExpired')} action={t('common.back')} onAction={() => router.back()} />
      </Screen>
    );
  }

  const requote = async () => {
    setError(null);
    try {
      update({ quote: await quoteDraft(draft) });
    } catch (e) {
      setError(errorMessage(e, t('common.offline')));
    }
  };

  const book = async () => {
    setError(null);
    try {
      const b = await api.bookings.create({ quoteId: quote.id, address, notes: draft.notes || undefined, paymentMethod });
      reset();
      if (router.canDismiss()) router.dismissAll();
      if (paymentMethod === 'cash') router.push(`/booking/${b.id}`);
      else router.push({ pathname: '/pay/[bookingId]', params: { bookingId: b.id, gateway: paymentMethod, msisdn: draft.msisdn, auto: '1' } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'provider_unavailable') {
        setProviderBlocked(true);
        setError(t('providers.unavailable'));
        return;
      }
      if (e instanceof ApiError && (e.code === 'quote_expired' || e.code === 'quote_used')) {
        update({ quote: null });
        await requote();
      }
      setError(errorMessage(e, t('common.offline')));
    }
  };

  return (
    <Screen footer={<Button title={t('confirm.book')} onPress={book} testID="book-now" />}>
      {error ? (
        <Banner
          tone="danger"
          title={error}
          testID="confirm-error"
          action={providerBlocked ? t('book.anyProvider') : undefined}
          onAction={async () => {
            setProviderBlocked(false);
            setError(null);
            update({ provider: null });
            try {
              update({ quote: await quoteDraft({ ...draft, provider: null }) });
            } catch (e) {
              setError(errorMessage(e, t('common.offline')));
            }
          }}
        />
      ) : null}
      <Card>
        <Strong style={{ fontSize: 20 }}>{service.name}</Strong>
        <KV k={t('confirm.when')} v={quote.is_emergency ? t('book.asap') : formatDateTime(quote.scheduled_at)} />
        <KV k={t('confirm.where')} v={`${address.area} · ${address.landmark}`} />
        {address.contactPhone ? <KV k={t('address.contactPhone')} v={formatLocalPhone(address.contactPhone)} /> : null}
        <KV k={t('confirm.payWith')} v={t.dyn(`method.${paymentMethod}`, paymentMethod)} />
        {draft.provider ? <KV k={t('detail.fixer')} v={draft.provider.business_name} /> : null}
      </Card>
      <SectionTitle>{t('detail.price')}</SectionTitle>
      <QuoteCard quote={quote} onRequote={requote} />
    </Screen>
  );
}
