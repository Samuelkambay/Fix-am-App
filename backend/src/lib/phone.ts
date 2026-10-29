import { badRequest } from './errors.js';

export type Operator = 'orange' | 'africell' | 'qcell' | 'unknown';

/**
 * Sierra Leone mobile prefixes (first two digits of the 8-digit national number).
 * Compiled from public numbering-plan summaries; sources disagree on a few ranges, so confirm against
 * the current NatCA numbering plan before launch. Admins can override it with the `phone_prefixes` setting.
 */
export const DEFAULT_PREFIXES: Record<Exclude<Operator, 'unknown'>, string[]> = {
  orange: ['72', '73', '74', '75', '76', '78', '79'],
  africell: ['30', '33', '70', '77', '80', '88', '90', '99'],
  qcell: ['31', '32', '34', '35'],
};

/** Mobile money wallet that lives on each network's SIM. */
export const OPERATOR_WALLET: Record<Exclude<Operator, 'unknown'>, string> = {
  orange: 'orange_money',
  africell: 'afrimoney',
  qcell: 'qmoney',
};

/** Accepts 076123456, 76 123 456, 23276123456 or +232 76 123456 and returns +23276123456. */
export function normalizeSlPhone(input: string): string {
  let digits = String(input).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('232')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^\d{8}$/.test(digits)) {
    throw badRequest('invalid_phone', 'Enter a Sierra Leone mobile number, e.g. 076 123 456');
  }
  return `+232${digits}`;
}

export function detectOperator(e164: string, prefixes = DEFAULT_PREFIXES): Operator {
  const nsn = e164.replace(/^\+232/, '');
  const p = nsn.slice(0, 2);
  for (const [op, list] of Object.entries(prefixes)) {
    if (list.includes(p)) return op as Operator;
  }
  return 'unknown';
}

export function maskPhone(e164: string): string {
  return e164.replace(/^(\+232\d{2})\d{3}(\d{3})$/, '$1***$2');
}
