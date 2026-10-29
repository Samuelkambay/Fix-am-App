import { config } from '../../config.js';
import { query, type Db, pool } from '../../db.js';

/**
 * SMS is the primary notification channel in Sierra Leone (works on every handset, no data needed).
 * Messages go through an outbox table; a real gateway adapter (e.g. an aggregator with Orange/Africell/Qcell
 * routes) drains it. The console provider marks messages sent immediately and logs them.
 */
export async function sendSms(phone: string, body: string, db: Db = pool): Promise<void> {
  const provider = config.smsProvider;
  await query(
    `INSERT INTO sms_outbox (phone, body, provider, status, sent_at) VALUES ($1, $2, $3, $4, $5)`,
    [phone, body, provider, provider === 'console' ? 'sent' : 'queued', provider === 'console' ? new Date() : null],
    db,
  );
  if (provider === 'console' && !config.isTest) console.log(`[sms] ${phone}: ${body}`);
}
