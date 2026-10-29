import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { FixamApi } from '../api';
import { ApiError } from '../errors';
import { readJson, writeJson, type KeyValueStore } from '../storage';
import type { Language, LoginResult, User } from '../types';
import { I18nProvider } from './i18n';
import { configureQueryCache } from './query';

interface SessionValue {
  api: FixamApi;
  kv: KeyValueStore;
  /** null = logged out; undefined = still loading. */
  user: User | null | undefined;
  ready: boolean;
  /** Payments show the sandbox "Simulate approval" button when the server reports sandbox gateways. */
  devMode: boolean;
  onLoggedIn: (res: LoginResult) => Promise<void>;
  refreshUser: () => Promise<User | null>;
  updateUser: (u: User) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside AppProviders');
  return v;
}

/** The logged-in user (throws if logged out; use inside authenticated screens). */
export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error('Not logged in');
  return user;
}

const USER_KEY = 'session:user';
const LANG_KEY = 'session:lang';

/** Safe area, session (tokens + current user), language and list cache in one wrapper for both apps. */
export function AppProviders({ api, kv, devMode = false, children }: { api: FixamApi; kv: KeyValueStore; devMode?: boolean; children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [lang, setLangState] = useState<Language>('en');

  useEffect(() => {
    configureQueryCache(kv);
    api.client.setSessionExpiredHandler(() => {
      setUser(null);
      void writeJson(kv, USER_KEY, null);
    });
    (async () => {
      const savedLang = await kv.getItem(LANG_KEY);
      if (savedLang === 'en' || savedLang === 'kri') setLangState(savedLang);
      if (!(await api.client.hasSession())) {
        setUser(null);
        return;
      }
      try {
        const me = await api.auth.me();
        setUser(me);
        setLangState(me.language);
        await writeJson(kv, USER_KEY, me);
      } catch (e) {
        // Offline at start-up: carry on with the last known user rather than forcing a new login.
        const cached = await readJson<User>(kv, USER_KEY);
        if (e instanceof ApiError && e.isNetwork && cached) setUser(cached);
        else setUser(null);
      }
    })();
  }, [api, kv]);

  const setLang = useCallback(
    (l: Language) => {
      setLangState(l);
      void kv.setItem(LANG_KEY, l);
      if (user && user.language !== l) {
        setUser({ ...user, language: l });
        api.auth.updateMe({ language: l }).catch(() => {});
      }
    },
    [api, kv, user],
  );

  const onLoggedIn = useCallback(
    async (res: LoginResult) => {
      setUser(res.user);
      await writeJson(kv, USER_KEY, res.user);
      // A new account takes the language chosen on the login screen.
      if (res.isNewUser && res.user.language !== lang) {
        try {
          const u = await api.auth.updateMe({ language: lang });
          setUser(u);
        } catch {
          /* best effort */
        }
      } else {
        setLangState(res.user.language);
      }
    },
    [api, kv, lang],
  );

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.auth.me();
      setUser(me);
      await writeJson(kv, USER_KEY, me);
      return me;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      return null;
    }
  }, [api, kv]);

  const updateUser = useCallback(
    (u: User) => {
      setUser(u);
      void writeJson(kv, USER_KEY, u);
    },
    [kv],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* offline: tokens are cleared locally anyway */
    }
    await writeJson(kv, USER_KEY, null);
    setUser(null);
  }, [api, kv]);

  const value = useMemo<SessionValue>(
    () => ({ api, kv, user, ready: user !== undefined, devMode, onLoggedIn, refreshUser, updateUser, logout }),
    [api, kv, user, devMode, onLoggedIn, refreshUser, updateUser, logout],
  );

  return (
    <SafeAreaProvider>
      <Ctx.Provider value={value}>
        <I18nProvider lang={lang} setLang={setLang}>
          {children}
        </I18nProvider>
      </Ctx.Provider>
    </SafeAreaProvider>
  );
}
