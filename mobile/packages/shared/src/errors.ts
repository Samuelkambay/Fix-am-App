/** Error thrown by the API client. `status` is 0 when the request never reached the server. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** No connection, DNS failure, or the request timed out. Safe to retry (with the same Idempotency-Key for payments). */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** The server answered but something broke on its side or the operator's. Retrying with the same key is safe. */
  get isServer(): boolean {
    return this.status >= 500;
  }

  /** Worth retrying automatically: the server may or may not have processed it. */
  get isRetryable(): boolean {
    return this.isNetwork || this.isServer;
  }
}

export const NETWORK_ERROR = 'network_error';
export const TIMEOUT = 'timeout';
export const SESSION_EXPIRED = 'session_expired';

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && e.isNetwork;
}

/** Field errors from a 400 validation_error (zod `flatten()` shape). */
export function fieldErrors(e: unknown): Record<string, string[]> {
  if (!(e instanceof ApiError) || e.code !== 'validation_error') return {};
  const d = e.details as { fieldErrors?: Record<string, string[]> } | undefined;
  return d?.fieldErrors ?? {};
}

/** A short message for the user. Network problems get a plain offline message. */
export function errorMessage(e: unknown, offlineText = 'No connection. Check your data or Wi-Fi and try again.'): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return offlineText;
    const fields = Object.keys(fieldErrors(e));
    if (fields.length) return `${e.message}: ${fields.join(', ')}`;
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
