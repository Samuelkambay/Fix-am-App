import express, { Router } from 'express';
import { one, query } from '../../db.js';
import { randomToken } from '../../lib/crypto.js';
import { ah } from '../../lib/http.js';
import { formatLeone } from '../../lib/money.js';
import { detectOperator, normalizeSlPhone, OPERATOR_WALLET } from '../../lib/phone.js';
import { verifyBadgeCode } from '../badges/badges.service.js';
import { createBooking } from '../bookings/bookings.service.js';
import { createPayment } from '../payments/payments.service.js';
import { createQuote, priceFor } from '../pricing/pricing.service.js';
import { getSetting } from '../settings/settings.service.js';

/**
 * USSD menu for feature phones (no data, no smartphone). Follows the common aggregator contract:
 * POST form fields sessionId, serviceCode, phoneNumber, text ("1*2*3" = every answer so far);
 * reply with plain text starting "CON " (continue) or "END " (close).
 * Screens stay under ~160 characters so they fit every handset.
 */
export const ussdRouter = Router();

const T = {
  en: {
    welcome: 'Welcome to FixAm\n1. Book a fixer\n2. My last booking\n3. Check a fixer badge\n4. Krio',
    pickCategory: 'Choose a trade:',
    pickService: 'Choose a job:',
    pickArea: 'Your area:',
    pickTime: 'When?\n1. As soon as possible\n2. Tomorrow 9am\n3. Tomorrow 2pm',
    payWith: 'Pay with:\n1. Cash after the job\n2. Mobile money',
    landmark: 'Type a landmark near you (e.g. near Kissy Police Station):',
    badgePrompt: 'Enter the badge code (e.g. FXB-ABC234):',
    invalid: 'Invalid choice. Please dial again.',
    none: 'You have no bookings yet.',
    noServices: 'No jobs in this trade yet.',
  },
  // Krio strings: written in ASCII for GSM handsets. Have a native speaker review before launch.
  kri: {
    welcome: 'Kushe! Welkam na FixAm\n1. Book fixman\n2. Mi las booking\n3. Chek fixman in badge\n4. English',
    pickCategory: 'Pik di wok:',
    pickService: 'Pik wetin yu want:',
    pickArea: 'Usai yu de:',
    pickTime: 'Wetin tem?\n1. Naw naw\n2. Tumara 9 oklok mornin\n3. Tumara 2 oklok',
    payWith: 'Pe wit:\n1. Kesh afta di wok\n2. Mobile money',
    landmark: 'Rait wan ples we de nia yu (lek nia Kissy Police):',
    badgePrompt: 'Put di badge code (lek FXB-ABC234):',
    invalid: 'Dat nor rait. Dial bak.',
    none: 'Yu nor get booking yet.',
    noServices: 'No wok de na dis trade yet.',
  },
};

const MAX_ITEMS = 8;
const list = (title: string, items: { name: string }[]) => `${title}\n${items.map((x, i) => `${i + 1}. ${x.name}`).join('\n')}`;

function pick<T>(items: T[], answer: string | undefined): T | undefined {
  const n = Number(answer);
  return Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : undefined;
}

function scheduledFor(choice: string): { at: Date; emergency: boolean } | undefined {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); // Freetown is UTC+0
  if (choice === '1') return { at: new Date(Date.now() + 60 * 60_000), emergency: true };
  if (choice === '2') return { at: new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 9)), emergency: false };
  if (choice === '3') return { at: new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 14)), emergency: false };
  return undefined;
}

export async function handleUssd(sessionId: string, phoneRaw: string, text: string): Promise<string> {
  const phone = normalizeSlPhone(phoneRaw);
  let user = await one('SELECT * FROM users WHERE phone = $1', [phone]);
  const lang: 'en' | 'kri' = user?.language === 'kri' ? 'kri' : 'en';
  const t = T[lang];
  const parts = text === '' ? [] : text.split('*');
  await query(
    `INSERT INTO ussd_sessions (session_id, phone, state, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (session_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [sessionId, phone, JSON.stringify({ text })],
  );

  if (parts.length === 0) return `CON ${t.welcome}`;
  const [menu, ...rest] = parts;

  if (menu === '4') {
    const next = lang === 'en' ? 'kri' : 'en';
    if (user) await query('UPDATE users SET language = $2 WHERE id = $1', [user.id, next]);
    else await query(`INSERT INTO users (phone, language) VALUES ($1,$2)`, [phone, next]);
    return `CON ${T[next].welcome}`;
  }

  if (menu === '2') {
    if (!user) return `END ${t.none}`;
    const b = await one(
      `SELECT b.code, b.status, b.total_minor, s.name FROM bookings b JOIN services s ON s.id = b.service_id
        WHERE b.customer_id = $1 ORDER BY b.created_at DESC LIMIT 1`,
      [user.id],
    );
    if (!b) return `END ${t.none}`;
    return `END ${b.code}: ${b.name}\nStatus: ${b.status.replace('_', ' ')}\nTotal: ${formatLeone(b.total_minor)}`;
  }

  if (menu === '3') {
    if (!rest[0]) return `CON ${t.badgePrompt}`;
    const r = await verifyBadgeCode(rest[0]);
    if (!r.valid) return `END Code ${rest[0].toUpperCase()} is NOT valid${r.reason ? ` (${r.reason})` : ''}. Do not let this person in. Call FixAm support.`;
    return `END VALID: ${r.badge}\n${r.provider} (${r.ownerName ?? ''})\nRating ${r.rating}, ${r.completedJobs} jobs`;
  }

  if (menu !== '1') return `END ${t.invalid}`;

  const categories = await query(`SELECT id, name FROM categories WHERE active AND parent_id IS NULL ORDER BY sort_order, name LIMIT ${MAX_ITEMS}`);
  if (rest.length === 0) return `CON ${list(t.pickCategory, categories)}`;
  const category = pick(categories, rest[0]);
  if (!category) return `END ${t.invalid}`;

  const services = await query(
    `SELECT s.id, s.name FROM services s JOIN categories c ON c.id = s.category_id
      WHERE s.active AND (c.id = $1 OR c.parent_id = $1) ORDER BY s.name LIMIT ${MAX_ITEMS}`,
    [category.id],
  );
  if (!services.length) return `END ${t.noServices}`;
  if (rest.length === 1) return `CON ${list(t.pickService, services)}`;
  const service = pick(services, rest[1]);
  if (!service) return `END ${t.invalid}`;

  const zones = await query(`SELECT id, name FROM zones WHERE active ORDER BY city, name LIMIT ${MAX_ITEMS}`);
  if (rest.length === 2) return `CON ${list(t.pickArea, zones.map((z) => ({ name: z.name.replace(/^Freetown - /, '') })))}`;
  const zone = pick(zones, rest[2]);
  if (!zone) return `END ${t.invalid}`;

  if (rest.length === 3) return `CON ${t.pickTime}`;
  const when = scheduledFor(rest[3]);
  if (!when) return `END ${t.invalid}`;

  if (rest.length === 4) {
    const price = await priceFor({ serviceId: service.id, zoneId: zone.id, scheduledAt: when.at, isEmergency: when.emergency });
    const peak = price.surchargeMinor > 0 ? ` incl. ${price.appliedRules.map((r) => r.label).join(', ')}` : '';
    return `CON ${service.name}\nPrice: ${formatLeone(price.totalMinor)}${peak}\n${t.payWith}`;
  }
  if (!['1', '2'].includes(rest[4])) return `END ${t.invalid}`;

  if (rest.length === 5) return `CON ${t.landmark}`;
  const landmark = rest.slice(5).join('*').trim().slice(0, 200);
  if (landmark.length < 2) return `END ${t.invalid}`;

  // The mobile network supplies the caller's number, so USSD users are created without an SMS code.
  if (!user) user = await one(`INSERT INTO users (phone, language, phone_verified_at) VALUES ($1,$2,now()) RETURNING *`, [phone, lang]);

  let paymentMethod = 'cash';
  if (rest[4] === '2') {
    const op = detectOperator(phone, await getSetting('phone_prefixes'));
    paymentMethod = op === 'unknown' ? 'monime' : OPERATOR_WALLET[op];
  }
  const quote = await createQuote({ serviceId: service.id, zoneId: zone.id, scheduledAt: when.at, isEmergency: when.emergency, customerId: user.id });
  const booking = await createBooking(
    { id: user.id, phone },
    { quoteId: quote.id, address: { area: zone.name, landmark }, paymentMethod: paymentMethod as any, channel: 'ussd' },
  );

  if (paymentMethod !== 'cash') {
    try {
      const p = await createPayment({
        userId: user.id, purpose: 'booking', gateway: paymentMethod, msisdn: phone, amountMinor: booking.total_minor,
        idempotencyKey: `ussd-${sessionId}-${randomToken(4)}`, bookingId: booking.id, description: `FixAm booking ${booking.code}`, reference: booking.code,
      });
      return `END Booked ${booking.code}: ${formatLeone(booking.total_minor)}.\n${p.customer_action?.message ?? 'Approve the payment on your phone.'}`;
    } catch {
      return `END Booked ${booking.code}: ${formatLeone(booking.total_minor)}. Mobile money failed - you can pay cash after the job.`;
    }
  }
  return `END Booked ${booking.code}: ${formatLeone(booking.total_minor)} cash after the job. We will SMS you when a fixer accepts.`;
}

ussdRouter.post(
  '/',
  express.urlencoded({ extended: false }),
  ah(async (req, res) => {
    const { sessionId, phoneNumber, text } = req.body ?? {};
    res.type('text/plain');
    // phoneNumber is trusted as the caller's verified number, so only the USSD aggregator may call this endpoint.
    // Set USSD_SHARED_SECRET (and/or restrict by IP at the load balancer) in production.
    const secret = process.env.USSD_SHARED_SECRET;
    if (secret && req.header('x-ussd-secret') !== secret && req.query.key !== secret) {
      res.status(401).send('END Unauthorized');
      return;
    }
    if (!sessionId || !phoneNumber) {
      res.status(400).send('END Bad request');
      return;
    }
    try {
      res.send(await handleUssd(String(sessionId), String(phoneNumber), String(text ?? '')));
    } catch (e) {
      console.error('ussd error', e);
      res.send('END Sorry, something went wrong. Please try again.');
    }
  }),
);
