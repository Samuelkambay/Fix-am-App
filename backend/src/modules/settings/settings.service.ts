import { query, type Db, pool } from '../../db.js';
import { DEFAULT_PREFIXES } from '../../lib/phone.js';

export const SETTING_DEFAULTS = {
  // Peak-hour pricing guardrails (consumer protection: surge can never exceed these).
  'pricing.max_multiplier': 1.75,
  'pricing.max_surcharge_minor': 50000_00, // Le 50,000
  'pricing.demand_window_hours': 2,
  // Commission & tax. Sierra Leone GST is 15%; it is charged on the platform's commission (its service fee).
  'commission.gst_rate_bps': 1500,
  'commission.gst_borne_by': 'provider' as 'provider' | 'platform',
  // Cash jobs: provider holds the cash and owes the platform its commission.
  // Above this unpaid amount the provider cannot accept new jobs until they settle by mobile money.
  'cash.max_commission_due_minor': 2000_00, // Le 2,000
  // Payouts to provider mobile money wallets.
  'payout.min_minor': 50_00,
  'payout.fee_minor': 0,
  // Providers must hold these approved badges before they can accept jobs.
  'badges.required_to_accept_jobs': ['NATIONAL_ID'] as string[],
  // Mobile money: require the wallet to match the SIM network detected from the number prefix.
  'payment.strict_operator_match': true,
  'phone_prefixes': DEFAULT_PREFIXES,
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

export async function getSetting<K extends SettingKey>(key: K, db: Db = pool): Promise<SettingValue<K>> {
  const rows = await query('SELECT value FROM settings WHERE key = $1', [key], db);
  return (rows[0]?.value ?? SETTING_DEFAULTS[key]) as SettingValue<K>;
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const rows = await query('SELECT key, value FROM settings');
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export async function setSetting(key: SettingKey, value: unknown, db: Db = pool) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
    db,
  );
}
