import { one, query, type Db, pool } from '../../db.js';

export type AccountType = 'provider' | 'customer' | 'platform_revenue' | 'platform_tax';

export interface LedgerEntry {
  accountType: AccountType;
  accountId: string | null;
  entryType: string;
  amountMinor: number;
  bookingId?: string | null;
  paymentId?: string | null;
  payoutId?: string | null;
  memo?: string;
}

export async function post(entries: LedgerEntry[], db: Db): Promise<void> {
  for (const e of entries) {
    if (e.amountMinor === 0) continue;
    await query(
      `INSERT INTO ledger_entries (account_type, account_id, entry_type, amount_minor, booking_id, payment_id, payout_id, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e.accountType, e.accountId, e.entryType, e.amountMinor, e.bookingId ?? null, e.paymentId ?? null, e.payoutId ?? null, e.memo ?? null],
      db,
    );
  }
}

export async function balance(accountType: AccountType, accountId: string | null, db: Db = pool): Promise<number> {
  const row = await one<{ b: number }>(
    `SELECT COALESCE(sum(amount_minor), 0)::bigint AS b FROM ledger_entries
      WHERE account_type = $1 AND account_id IS NOT DISTINCT FROM $2`,
    [accountType, accountId],
    db,
  );
  return Number(row?.b ?? 0);
}

/** Serialises balance-changing operations on one account (payouts, wallet payments) within a transaction. */
export async function lockAccount(accountType: AccountType, accountId: string, db: Db): Promise<void> {
  await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${accountType}:${accountId}`], db);
}

export async function entries(accountType: AccountType, accountId: string | null, limit = 100, offset = 0) {
  return query(
    `SELECT id, entry_type, amount_minor, booking_id, payment_id, payout_id, memo, created_at,
            sum(amount_minor) OVER (ORDER BY id) AS running_balance_minor
       FROM ledger_entries WHERE account_type = $1 AND account_id IS NOT DISTINCT FROM $2
      ORDER BY id DESC LIMIT $3 OFFSET $4`,
    [accountType, accountId, limit, offset],
  );
}
