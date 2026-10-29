import { createContext, useContext } from 'react';
import type { ProviderMe } from '../../api';

export interface ProviderCtx {
  me: ProviderMe;
  reload: () => Promise<void>;
}

export const ProviderContext = createContext<ProviderCtx | null>(null);

/** The /providers/me payload, shared by every provider page and refreshed after actions that change it. */
export function useProvider(): ProviderCtx {
  const c = useContext(ProviderContext);
  if (!c) throw new Error('useProvider outside ProviderLayout');
  return c;
}
