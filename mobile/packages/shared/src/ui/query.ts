import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../errors';
import { readJson, writeJson, type KeyValueStore } from '../storage';

let cacheStore: KeyValueStore | null = null;

/** Lists are cached so the app opens instantly and still shows something on a dead 2G link. */
export function configureQueryCache(store: KeyValueStore | null) {
  cacheStore = store;
}

interface Cached<T> {
  at: number;
  data: T;
}

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
  /** The last refresh failed for lack of connection; `data` may be from the cache. */
  offline: boolean;
  /** When the shown data was fetched (ms), if it came from the cache. */
  cachedAt: number | null;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/**
 * Minimal stale-while-revalidate fetch hook. `key` null = do not fetch yet.
 * With `cache: true` the last good response is stored under `key` and shown while refreshing.
 */
export function useApiQuery<T>(key: string | null, fetcher: () => Promise<T>, opts: { cache?: boolean; pollMs?: number } = {}): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(!!key);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;
  const hasData = useRef(false);

  const run = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const k = keyRef.current;
      if (!k) return;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const d = await fetchRef.current();
        if (keyRef.current !== k) return;
        setData(d);
        hasData.current = true;
        setError(null);
        setOffline(false);
        setCachedAt(null);
        if (opts.cache && cacheStore) await writeJson(cacheStore, `q:${k}`, { at: Date.now(), data: d } satisfies Cached<T>);
      } catch (e) {
        if (keyRef.current !== k) return;
        const isOffline = e instanceof ApiError && e.isNetwork;
        setOffline(isOffline);
        setError(e);
      } finally {
        if (keyRef.current === k) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [opts.cache],
  );

  useEffect(() => {
    hasData.current = false;
    setData(undefined);
    setError(null);
    setCachedAt(null);
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    (async () => {
      if (opts.cache && cacheStore) {
        const c = await readJson<Cached<T>>(cacheStore, `q:${key}`);
        if (c && !cancelled && !hasData.current) {
          setData(c.data);
          setCachedAt(c.at);
          setLoading(false);
        }
      }
      if (!cancelled) await run('initial');
    })();
    return () => {
      cancelled = true;
    };
  }, [key, opts.cache, run]);

  useEffect(() => {
    if (!opts.pollMs || !key) return;
    const id = setInterval(() => void run('initial'), opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs, key, run]);

  const reload = useCallback(() => run('refresh'), [run]);
  const set = useCallback((d: T) => setData(d), []);
  return { data, error, loading, refreshing, offline, cachedAt, reload, setData: set };
}
