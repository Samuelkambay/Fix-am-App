import { hmacSha256Hex, safeEqual } from '../../../lib/crypto.js';
import { GatewaySignatureError } from './types.js';

export const SIGNATURE_HEADER = 'x-fixam-signature';
const TOLERANCE_SEC = 5 * 60;

/** Stripe-style signature: "t=<unix seconds>,v1=<hex hmac of `${t}.${body}`>". Timestamp blocks replays. */
export function signPayload(secret: string, rawBody: string, at = Math.floor(Date.now() / 1000)): string {
  return `t=${at},v1=${hmacSha256Hex(secret, `${at}.${rawBody}`)}`;
}

export function verifySignature(secret: string, header: string | string[] | undefined, rawBody: string): void {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new GatewaySignatureError('Missing signature header');
  const parts = Object.fromEntries(value.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1) throw new GatewaySignatureError('Malformed signature header');
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SEC) throw new GatewaySignatureError('Signature timestamp outside tolerance');
  if (!safeEqual(hmacSha256Hex(secret, `${t}.${rawBody}`), parts.v1)) throw new GatewaySignatureError('Signature mismatch');
}
