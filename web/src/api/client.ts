// One fetch wrapper for the whole app: base URL, bearer auth, token refresh on 401, and error parsing.
import type { AuthTokens, AuthUser } from './types';

export const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '');

/** Every failure surfaces as an ApiError with a stable `code` and a human `message`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ───────── Session storage ─────────
export interface Session extends AuthTokens {
  user: AuthUser;
}

const STORAGE_KEY = 'fixam.session';
type Listener = (s: Session | null) => void;
const listeners = new Set<Listener>();
let cached: Session | null | undefined;

export function getSession(): Session | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function setSession(s: Session | null) {
  cached = s;
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked (private mode): keep the in-memory session */
  }
  listeners.forEach((l) => l(s));
}

export function onSessionChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Another tab logged in/out: follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    cached = undefined;
    const s = getSession();
    listeners.forEach((l) => l(s));
  });
}

// ───────── Refresh ─────────
let refreshing: Promise<boolean> | null = null;

/** Rotates the refresh token once, even when several requests hit 401 at the same time. */
async function refreshTokens(): Promise<boolean> {
  const s = getSession();
  if (!s?.refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: s.refreshToken }),
        });
        if (!res.ok) {
          setSession(null);
          return false;
        }
        const t = (await res.json()) as AuthTokens;
        const current = getSession();
        if (current) setSession({ ...current, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn });
        return true;
      } catch {
        return false; // offline: keep the session, the caller sees a network error
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

// ───────── Requests ─────────
export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  /** Send `body` as-is (Blob/File) with this content type instead of JSON. */
  rawContentType?: string;
  auth?: boolean;
  signal?: AbortSignal;
  responseType?: 'json' | 'blob' | 'text';
}

function buildUrl(path: string, query?: Query) {
  // API responses contain absolute API paths such as /api/v1/uploads/x.jpg; map them onto API_BASE.
  const rel = path.startsWith('/api/v1/') ? path.slice('/api/v1'.length) : path;
  let url = `${API_BASE}${rel.startsWith('/') ? '' : '/'}${rel}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || 'Request failed';
  let details: unknown;
  try {
    const text = await res.text();
    if (text) {
      const j = JSON.parse(text);
      if (j?.error) {
        code = j.error.code ?? code;
        message = j.error.message ?? message;
        details = j.error.details;
      }
    }
  } catch {
    /* not JSON (proxy error page etc.) */
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    if (code.startsWith('http_')) message = 'The server is not responding. Try again in a moment.';
  }
  return new ApiError(res.status, code, message, details);
}

export async function request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const { auth = true } = opts;
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      if (opts.rawContentType) {
        headers['Content-Type'] = opts.rawContentType;
        body = opts.body as BodyInit;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
    }
    const s = getSession();
    if (auth && s?.accessToken) headers.Authorization = `Bearer ${s.accessToken}`;
    return fetch(buildUrl(path, opts.query), { method, headers, body, signal: opts.signal });
  };

  let res: Response;
  try {
    res = await send();
    const isAuthCall = path.startsWith('/auth/login') || path.startsWith('/auth/otp') || path.startsWith('/auth/refresh');
    if (res.status === 401 && auth && !isAuthCall && getSession()?.refreshToken) {
      if (await refreshTokens()) res = await send();
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error', 'Cannot reach FixAm. Check your connection and try again.');
  }

  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401 && auth && getSession()) setSession(null);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  if (opts.responseType === 'blob') return (await res.blob()) as T;
  if (opts.responseType === 'text') return (await res.text()) as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const http = {
  get: <T>(path: string, query?: Query, o?: RequestOptions) => request<T>('GET', path, { ...o, query }),
  post: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('POST', path, { ...o, body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PATCH', path, { ...o, body: body ?? {} }),
  put: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PUT', path, { ...o, body: body ?? {} }),
  del: <T>(path: string, o?: RequestOptions) => request<T>('DELETE', path, o),
};

/** Random key for POST /payments. Reuse the same key when retrying after a timeout. */
export function idempotencyKey(prefix = 'web'): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
