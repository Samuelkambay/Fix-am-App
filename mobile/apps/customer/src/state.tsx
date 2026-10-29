import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, readJson, writeJson, type Address, type PaymentMethod, type ProviderSummary, type Quote, type Service, type Zone } from '@fixam/shared';
import { api, kv } from './platform';

// ───────── Zone (GPS or manual) ─────────
type ZoneStatus = 'idle' | 'detecting' | 'outside' | 'denied' | 'error';

interface ZoneValue {
  zone: Zone | null;
  status: ZoneStatus;
  loaded: boolean;
  setZone: (z: Zone) => void;
  detect: () => Promise<Zone | null>;
}

const ZoneCtx = createContext<ZoneValue | null>(null);
const ZONE_KEY = 'customer:zone';

export function ZoneProvider({ children }: { children: ReactNode }) {
  const [zone, setZoneState] = useState<Zone | null>(null);
  const [status, setStatus] = useState<ZoneStatus>('idle');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    readJson<Zone>(kv, ZONE_KEY).then((z) => {
      if (z) setZoneState(z);
      setLoaded(true);
    });
  }, []);

  const setZone = useCallback((z: Zone) => {
    setZoneState(z);
    setStatus('idle');
    void writeJson(kv, ZONE_KEY, z);
  }, []);

  /** GPS -> /zones/resolve. Low accuracy is enough (zones are kilometres wide) and much faster on cheap phones. */
  const detect = useCallback(async () => {
    setStatus('detecting');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setStatus('denied');
        return null;
      }
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null)) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      const z = await api.zones.resolve(pos.coords.latitude, pos.coords.longitude);
      setZone(z);
      return z;
    } catch (e) {
      setStatus(e instanceof ApiError && e.status === 404 ? 'outside' : e instanceof ApiError ? 'error' : 'denied');
      return null;
    }
  }, [setZone]);

  const value = useMemo(() => ({ zone, status, loaded, setZone, detect }), [zone, status, loaded, setZone, detect]);
  return <ZoneCtx.Provider value={value}>{children}</ZoneCtx.Provider>;
}

export function useZone() {
  const v = useContext(ZoneCtx);
  if (!v) throw new Error('useZone outside ZoneProvider');
  return v;
}

// ───────── Booking draft (service -> time -> provider -> address -> payment -> confirm) ─────────
export interface BookingDraft {
  service: Service | null;
  zone: Zone | null;
  date: string;
  /** ISO time of the chosen hour; null with isEmergency (ASAP). */
  scheduledAt: string | null;
  isEmergency: boolean;
  quantity: number;
  provider: ProviderSummary | null;
  quote: Quote | null;
  address: Address | null;
  notes: string;
  paymentMethod: PaymentMethod | null;
  msisdn: string;
}

const emptyDraft = (): BookingDraft => ({
  service: null, zone: null, date: '', scheduledAt: null, isEmergency: false, quantity: 1, provider: null, quote: null,
  address: null, notes: '', paymentMethod: null, msisdn: '',
});

interface DraftValue {
  draft: BookingDraft;
  update: (patch: Partial<BookingDraft>) => void;
  reset: (patch?: Partial<BookingDraft>) => void;
}

const DraftCtx = createContext<DraftValue | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const update = useCallback((patch: Partial<BookingDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      // Anything that changes the price invalidates the locked quote.
      const priceKeys: (keyof BookingDraft)[] = ['service', 'zone', 'scheduledAt', 'isEmergency', 'quantity', 'provider'];
      if (!('quote' in patch) && priceKeys.some((k) => k in patch && patch[k] !== d[k])) next.quote = null;
      return next;
    });
  }, []);
  const reset = useCallback((patch?: Partial<BookingDraft>) => setDraft({ ...emptyDraft(), ...patch }), []);
  const value = useMemo(() => ({ draft, update, reset }), [draft, update, reset]);
  return <DraftCtx.Provider value={value}>{children}</DraftCtx.Provider>;
}

export function useDraft() {
  const v = useContext(DraftCtx);
  if (!v) throw new Error('useDraft outside DraftProvider');
  return v;
}

/** Re-quotes the draft (used when the 15-minute lock runs out). */
export async function quoteDraft(d: BookingDraft): Promise<Quote> {
  if (!d.service || !d.zone) throw new Error('Choose a service and area first');
  const scheduledAt = d.isEmergency || !d.scheduledAt ? undefined : d.scheduledAt;
  return api.pricing.quote({
    serviceId: d.service.id,
    zoneId: d.zone.id,
    scheduledAt,
    isEmergency: d.isEmergency || undefined,
    quantity: d.service.price_unit === 'fixed' ? undefined : d.quantity,
    providerId: d.provider?.id,
  });
}
