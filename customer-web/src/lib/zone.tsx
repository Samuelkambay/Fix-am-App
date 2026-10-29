import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Zone } from '../api/types';

interface ZoneState {
  zones: Zone[];
  zone: Zone | null;
  setZone: (z: Zone) => void;
  locate: () => Promise<string | null>;
}

const Ctx = createContext<ZoneState>({ zones: [], zone: null, setZone: () => {}, locate: async () => null });
const KEY = 'fixam.zone';

export function ZoneProvider({ children }: { children: ReactNode }) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [zone, setZoneState] = useState<Zone | null>(null);

  useEffect(() => {
    api<Zone[]>('/zones')
      .then((list) => {
        setZones(list);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(KEY);
        } catch {
          /* ignore */
        }
        const found = list.find((z) => z.id === saved) ?? list.find((z) => z.name === 'Freetown - Central') ?? list[0] ?? null;
        setZoneState(found);
      })
      .catch(() => setZones([]));
  }, []);

  const setZone = (z: Zone) => {
    setZoneState(z);
    try {
      localStorage.setItem(KEY, z.id);
    } catch {
      /* ignore */
    }
  };

  /** Resolves the GPS position to a zone. Returns an error message, or null on success. */
  const locate = () =>
    new Promise<string | null>((resolve) => {
      if (!navigator.geolocation) return resolve('Location is not available on this device');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            setZone(await api<Zone>('/zones/resolve', { query: { lat: pos.coords.latitude, lng: pos.coords.longitude } }));
            resolve(null);
          } catch {
            resolve('FixAm is not in your area yet. Pick the nearest area from the list.');
          }
        },
        () => resolve('Could not get your location. Pick your area from the list.'),
        { timeout: 10000, maximumAge: 600000 },
      );
    });

  return <Ctx.Provider value={{ zones, zone, setZone, locate }}>{children}</Ctx.Provider>;
}

export const useZone = () => useContext(Ctx);

export const shortZone = (name: string) => name.replace(/^Freetown - /, '');
