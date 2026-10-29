import { ApiError, NETWORK_ERROR, SESSION_EXPIRED, TIMEOUT } from './errors';
import type { Tokens } from './types';

/** Where the access/refresh tokens live. The apps use expo-secure-store; scripts use memory. */
export interface TokenStore {
  get(): Promise<Tokens | null>;
  set(tokens: Tokens | null): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: Tokens | null = null;
  async get() {
    return this.tokens;
  }
  async set(tokens: Tokens | null) {
    this.tokens = tokens;
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** JSON body (serialised for you). */
  body?: unknown;
  /** Raw body (uploads). Sent as-is with `contentType`. */
  rawBody?: unknown;
  contentType?: string;
  headers?: Record<string, string>;
  /** Send the bearer token. Default true; anonymous endpoints still work without a session. */
  auth?: boolean;
  /** Automatic retries on network errors/timeouts. Default 1 for GET, 0 otherwise. */
  retries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  /** e.g. http://localhost:4000/api/v1 (Android emulator: http://10.0.2.2:4000/api/v1). */
  baseUrl: string;
  tokenStore?: TokenStore;
  fetch?: typeof fetch;
  /** Slow 2G/3G links: keep generous. Default 30 s. */
  timeoutMs?: number;
  /** Called once when the refresh token is rejected, so the app can return to the login screen. */
  onSessionExpired?: () => void;
}

type FetchLike = typeof fetch;

/**
 * Small fetch wrapper: bearer token, one transparent refresh on 401 (single-flight, so parallel
 * requests share one refresh), timeouts, and API error parsing into ApiError.
 */
export class ApiClient {
  readonly baseUrl: string;
  private readonly store: TokenStore;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private onSessionExpired?: () => void;
  private tokens: Tokens | null | undefined; // undefined = not loaded from the store yet
  private refreshing: Promise<boolean> | null = null;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.store = opts.tokenStore ?? new MemoryTokenStore();
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new Error('No fetch implementation available');
    this.fetchImpl = f.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.onSessionExpired = opts.onSessionExpired;
  }

  setSessionExpiredHandler(fn: (() => void) | undefined) {
    this.onSessionExpired = fn;
  }

  async getTokens(): Promise<Tokens | null> {
    if (this.tokens === undefined) this.tokens = await this.store.get();
    return this.tokens;
  }

  async setTokens(tokens: Tokens | null): Promise<void> {
    this.tokens = tokens;
    await this.store.set(tokens);
  }

  async hasSession(): Promise<boolean> {
    return !!(await this.getTokens())?.refreshToken;
  }

  get<T>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, opts);
  }
  post<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, { ...opts, body });
  }
  patch<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  put<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PUT', path, { ...opts, body });
  }
  delete<T>(path: string, opts?: RequestOptions) {
    return this.request<T>('DELETE', path, opts);
  }

  url(path: string, query?: Record<string, QueryValue>): string {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}${qs ? `?${qs}` : ''}`;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const retries = opts.retries ?? (method === 'GET' ? 1 : 0);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce<T>(method, path, opts, true);
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork && attempt < retries && !opts.signal?.aborted) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
  }

  private async requestOnce<T>(method: string, path: string, opts: RequestOptions, allowRefresh: boolean): Promise<T> {
    const useAuth = opts.auth !== false;
    const tokens = useAuth ? await this.getTokens() : null;
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    let body: unknown;
    if (opts.rawBody !== undefined) {
      body = opts.rawBody;
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
    } else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;

    const res = await this.send(this.url(path, opts.query), { method, headers, body }, opts);

    if (res.status === 401 && allowRefresh && tokens?.refreshToken && !path.startsWith('/auth/')) {
      if (await this.refresh(tokens.refreshToken)) return this.requestOnce<T>(method, path, opts, false);
      throw new ApiError(401, SESSION_EXPIRED, 'Your session has ended. Please log in again.');
    }
    return parseResponse<T>(res);
  }

  private async send(url: string, init: { method: string; headers: Record<string, string>; body: unknown }, opts: RequestOptions): Promise<Response> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    let timedOut = false;
    const timer = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;
    const onAbort = () => controller?.abort();
    opts.signal?.addEventListener?.('abort', onAbort);
    try {
      return await this.fetchImpl(url, { ...(init as RequestInit), signal: controller?.signal });
    } catch (e) {
      if (timedOut) throw new ApiError(0, TIMEOUT, 'The network is slow and the request timed out. Try again.');
      if (opts.signal?.aborted) throw new ApiError(0, 'aborted', 'Request cancelled');
      throw new ApiError(0, NETWORK_ERROR, 'No connection. Check your data or Wi-Fi and try again.', { cause: String(e) });
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener?.('abort', onAbort);
    }
  }

  /** Rotates tokens. Concurrent callers share one in-flight refresh. Returns false when the session is gone. */
  refresh(refreshToken?: string): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const rt = refreshToken ?? (await this.getTokens())?.refreshToken;
        if (!rt) return false;
        try {
          const res = await this.send(
            this.url('/auth/refresh'),
            { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ refreshToken: rt }) },
            {},
          );
          if (res.status === 401 || res.status === 400) {
            await this.setTokens(null);
            this.onSessionExpired?.();
            return false;
          }
          const tokens = await parseResponse<Tokens>(res);
          await this.setTokens(tokens);
          return true;
        } catch (e) {
          // Offline during refresh: keep the tokens so the next attempt can try again.
          if (e instanceof ApiError && e.isNetwork) throw e;
          return false;
        }
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (!res.ok) {
    const err = json?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? (res.status >= 500 ? 'Something went wrong on our side. Try again.' : `Request failed (${res.status})`),
      err?.details,
    );
  }
  return (json === undefined ? text : json) as T;
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * A unique key for POST /payments. Generate one per payment attempt and reuse it for every retry
 * of that attempt (timeouts on 2G are common), so the payer is never charged twice.
 */
export function newIdempotencyKey(prefix = 'fx'): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${Date.now().toString(36)}-${hex}`;
}
