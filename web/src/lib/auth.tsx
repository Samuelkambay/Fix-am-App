import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi, getSession, onSessionChange, setSession, type LoginResponse, type Role, type Session } from '../api';

interface AuthCtx {
  session: Session | null;
  role: Role | null;
  signIn: (r: LoginResponse) => Session;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setS] = useState<Session | null>(() => getSession());
  useEffect(() => onSessionChange(setS), []);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      role: session?.user.role ?? null,
      signIn: (r) => {
        const s: Session = { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresIn: r.expiresIn, user: r.user };
        setSession(s);
        return s;
      },
      signOut: async () => {
        const s = getSession();
        setSession(null);
        if (s?.refreshToken) await authApi.logout(s.refreshToken).catch(() => undefined);
      },
      refreshUser: async () => {
        const user = await authApi.me();
        const s = getSession();
        if (s) setSession({ ...s, user });
      },
    }),
    [session],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

export function homeFor(role: Role | null | undefined): string {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'provider') return '/provider/overview';
  if (role === 'customer') return '/become-provider';
  return '/login';
}
