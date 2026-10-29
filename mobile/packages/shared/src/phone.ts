// Sierra Leone phone helpers. Mirrors backend/src/lib/phone.ts so the app can validate and pick the right
// wallet before any request. The server may override prefixes with the `phone_prefixes` setting, so treat
// detection here as a hint and let the server's `/payments/methods?msisdn=` answer win when online.
import type { GatewayCode, Operator } from './types';

export const DEFAULT_PREFIXES: Record<Exclude<Operator, 'unknown'>, string[]> = {
  orange: ['72', '73', '74', '75', '76', '78', '79'],
  africell: ['30', '33', '70', '77', '80', '88', '90', '99'],
  qcell: ['31', '32', '34', '35'],
};

/** Mobile money wallet that lives on each network's SIM. */
export const OPERATOR_WALLET: Record<Exclude<Operator, 'unknown'>, GatewayCode> = {
  orange: 'orange_money',
  africell: 'afrimoney',
  qcell: 'qmoney',
};

/** Network a wallet needs (Monime accepts any network). */
export const WALLET_OPERATOR: Record<GatewayCode, Exclude<Operator, 'unknown'> | null> = {
  orange_money: 'orange',
  afrimoney: 'africell',
  qmoney: 'qcell',
  monime: null,
};

export const OPERATOR_NAME: Record<Operator, string> = {
  orange: 'Orange',
  africell: 'Africell',
  qcell: 'Qcell',
  unknown: 'Unknown network',
};

export class PhoneError extends Error {
  readonly code = 'invalid_phone';
  constructor(message = 'Enter a Sierra Leone mobile number, e.g. 076 123 456') {
    super(message);
    this.name = 'PhoneError';
  }
}

/** Accepts 076123456, 76 123 456, 23276123456 or +232 76 123456 and returns +23276123456. Throws PhoneError. */
export function normalizeSlPhone(input: string): string {
  let digits = String(input).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('232')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^\d{8}$/.test(digits)) throw new PhoneError();
  return `+232${digits}`;
}

/** Like normalizeSlPhone but returns null instead of throwing. */
export function tryNormalizeSlPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    return normalizeSlPhone(input);
  } catch {
    return null;
  }
}

export function isValidSlPhone(input: string): boolean {
  return tryNormalizeSlPhone(input) !== null;
}

export function detectOperator(e164: string, prefixes = DEFAULT_PREFIXES): Operator {
  const nsn = e164.replace(/^\+232/, '');
  const p = nsn.slice(0, 2);
  for (const [op, list] of Object.entries(prefixes)) {
    if (list.includes(p)) return op as Operator;
  }
  return 'unknown';
}

/** Operator for any input form; 'unknown' if the number is invalid. */
export function operatorOf(input: string): Operator {
  const e164 = tryNormalizeSlPhone(input);
  return e164 ? detectOperator(e164) : 'unknown';
}

/** Wallet that matches the SIM network, or Monime (any network) when unknown. */
export function suggestedWallet(input: string): GatewayCode {
  const op = operatorOf(input);
  return op === 'unknown' ? 'monime' : OPERATOR_WALLET[op];
}

/**
 * Null when the wallet works with the number. Otherwise the wallet the number's network needs,
 * e.g. Orange Money on an Africell number -> 'afrimoney'. Mirrors the server's wallet_network_mismatch check.
 */
export function walletMismatch(gateway: GatewayCode, input: string): GatewayCode | null {
  const need = WALLET_OPERATOR[gateway];
  if (!need) return null;
  const op = operatorOf(input);
  if (op === 'unknown' || op === need) return null;
  return OPERATOR_WALLET[op];
}

/** +23276123456 -> "076 123 456" (how people write numbers locally). */
export function formatLocalPhone(input: string | null | undefined): string {
  const e164 = tryNormalizeSlPhone(input ?? '');
  if (!e164) return input ?? '';
  const nsn = e164.slice(4);
  return `0${nsn.slice(0, 2)} ${nsn.slice(2, 5)} ${nsn.slice(5)}`;
}

/** Formats digits as they are typed: "076123" -> "076 123". */
export function formatPhoneAsYouType(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('232')) d = `0${d.slice(3)}`;
  if (d && !d.startsWith('0')) d = `0${d}`;
  d = d.slice(0, 9);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join(' ');
}

export function maskPhone(e164: string): string {
  return e164.replace(/^(\+232\d{2})\d{3}(\d{3})$/, '$1***$2');
}

/** tel: link for the dialer. */
export function telUrl(phone: string): string {
  return `tel:${tryNormalizeSlPhone(phone) ?? phone.replace(/\s/g, '')}`;
}
