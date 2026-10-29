import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getTokens, setTokens } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  signIn: (tokens: { accessToken: string; refreshToken: string }, user: User) => void;
  signOut: () => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ user: null, ready: false, signIn: () => {}, signOut: () => {}, reload: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (!getTokens()) {
      setUser(null);
      return;
    }
    try {
      setUser(await api<User>('/auth/me'));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    reload().finally(() => setReady(true));
  }, [reload]);

  const signIn = (tokens: { accessToken: string; refreshToken: string }, u: User) => {
    setTokens(tokens);
    setUser(u);
  };
  const signOut = () => {
    const t = getTokens();
    if (t) api('/auth/logout', { body: { refreshToken: t.refreshToken } }).catch(() => {});
    setTokens(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, ready, signIn, signOut, reload }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
