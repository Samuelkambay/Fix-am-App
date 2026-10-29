import type pg from 'pg';
import { config } from '../../config.js';
import { one, query, tx, type Db, pool } from '../../db.js';
import { hmacSha256Hex, readableCode, safeEqual } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { formatLeone } from '../../lib/money.js';
import type { AuthUser } from '../auth/auth.js';
import { approvedBadgeCodes, evaluatePerformanceBadges } from '../badges/badges.service.js';
import { settleBooking } from '../commission/commission.service.js';
import { sendSms } from '../notifications/sms.js';
import { refundBookingToWallet } from '../payments/payments.service.js';
import { getSetting } from '../settings/settings.service.js';
import { balance } from '../wallet/ledger.js';

export type BookingStatus = 'pending' | 'accepted' | 'assigned' | 'en_route' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';
export const PAYMENT_METHODS = ['cash', 'wallet', 'orange_money', 'afrimoney', 'qmoney', 'monime'] as const;

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['accepted', 'cancelled'],
  accepted: ['assigned', 'en_route', 'cancelled'],
  assigned: ['en_route', 'cancelled'],
  en_route: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'disputed'],
  completed: ['disputed'],
  disputed: ['completed', 'cancelled'],
  cancelled: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus) {
  return TRANSITIONS[from].includes(to);
}

/**
 * Start and completion codes are derived (HMAC of the booking id), so they never sit in the database in plain text.
 * The customer reads the start code to the handyman on arrival and the completion code when satisfied.
 * This proves the visit happened and that the customer accepts the work.
 */
export function bookingCode(bookingId: string, purpose: 'start' | 'complete'): string {
  const h = hmacSha256Hex(config.jwtSecret, `${purpose}:${bookingId}`);
  return String(parseInt(h.slice(0, 8), 16) % 10000).padStart(4, '0');
}

async function newBookingCode(db: Db) {
  for (;;) {
    const code = `FX-${readableCode(6)}`;
    if (!(await one('SELECT 1 FROM bookings WHERE code = $1', [code], db))) return code;
  }
}

const SETTABLE = new Set(['started_at', 'completed_at', 'cancelled_at', 'cancel_reason', 'disputed_at', 'dispute_reason']);

/** Applies a status change (validated against TRANSITIONS), optional timestamp/reason columns, and an audit event. */
async function transition(
  c: pg.PoolClient,
  booking: any,
  to: BookingStatus,
  actorId: string | null,
  note?: string,
  set: Record<string, unknown> = {},
) {
  if (!canTransition(booking.status, to)) throw conflict('invalid_transition', `Cannot move a ${booking.status} booking to ${to}`);
  const cols = Object.keys(set);
  for (const col of cols) if (!SETTABLE.has(col)) throw new Error(`Column ${col} cannot be set by a transition`);
  const assignments = cols.map((col, i) => `, ${col} = $${i + 3}`).join('');
  await c.query(`UPDATE bookings SET status = $2${assignments} WHERE id = $1`, [booking.id, to, ...cols.map((k) => set[k])]);
  await c.query(`INSERT INTO booking_events (booking_id, from_status, to_status, actor_id, note) VALUES ($1,$2,$3,$4,$5)`, [
    booking.id, booking.status, to, actorId, note ?? null,
  ]);
}

/** Cancels a settlement: posts opposite entries for every settlement line of the booking. */
async function reverseSettlement(c: pg.PoolClient, bookingId: string, memo: string) {
  await c.query(
    `INSERT INTO ledger_entries (account_type, account_id, entry_type, amount_minor, booking_id, memo)
     SELECT account_type, account_id, 'settlement_reversal', -amount_minor, booking_id, $2
       FROM ledger_entries WHERE booking_id = $1 AND entry_type IN ('job_earning','commission','commission_gst','cash_commission_due')`,
    [bookingId, memo],
  );
  await c.query('UPDATE bookings SET settled_at = NULL WHERE id = $1', [bookingId]);
}

async function lockBooking(c: pg.PoolClient, id: string) {
  const b = await one('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id], c);
  if (!b) throw notFound('Booking');
  return b;
}

/** Why a provider cannot take new work right now (empty array = can accept). */
export async function acceptBlockers(providerId: string, db: Db = pool): Promise<string[]> {
  const blockers: string[] = [];
  const p = await one('SELECT status, is_available FROM providers WHERE id = $1', [providerId], db);
  if (!p) return ['provider_not_found'];
  if (p.status !== 'active') blockers.push(`provider_${p.status}`);
  const owed = -(await balance('provider', providerId, db));
  if (owed > (await getSetting('cash.max_commission_due_minor', db))) blockers.push('cash_commission_limit_exceeded');
  const required = await getSetting('badges.required_to_accept_jobs', db);
  const held = await approvedBadgeCodes(providerId, db);
  for (const code of required) if (!held.includes(code)) blockers.push(`missing_badge:${code}`);
  return blockers;
}

export interface CreateBookingInput {
  quoteId: string;
  address: { area: string; landmark: string; street?: string; lat?: number; lng?: number; contactPhone?: string };
  notes?: string;
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  channel?: 'app' | 'web' | 'ussd';
}

export async function createBooking(customer: { id: string; phone: string }, input: CreateBookingInput) {
  const booking = await tx(async (c) => {
    const q = await one('SELECT * FROM price_quotes WHERE id = $1 FOR UPDATE', [input.quoteId], c);
    if (!q) throw notFound('Quote');
    if (q.customer_id && q.customer_id !== customer.id) throw notFound('Quote');
    if (q.used_at) throw conflict('quote_used', 'This price was already used for a booking');
    if (new Date(q.expires_at) < new Date()) throw conflict('quote_expired', 'Price expired. Get a new price.');
    if (q.provider_id) {
      const blockers = await acceptBlockers(q.provider_id, c);
      if (blockers.length) throw conflict('provider_unavailable', 'This provider cannot take bookings right now', { blockers });
    }
    await c.query('UPDATE price_quotes SET used_at = now(), customer_id = $2 WHERE id = $1', [q.id, customer.id]);
    const b = await one(
      `INSERT INTO bookings (code, customer_id, provider_id, service_id, zone_id, quote_id, channel, address, notes, scheduled_at,
                             is_emergency, payment_method, subtotal_minor, surcharge_minor, total_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [await newBookingCode(c), customer.id, q.provider_id, q.service_id, q.zone_id, q.id, input.channel ?? 'app',
       JSON.stringify({ ...input.address, contactPhone: input.address.contactPhone ?? customer.phone }), input.notes ?? null,
       q.scheduled_at, q.is_emergency, input.paymentMethod, q.subtotal_minor, q.surcharge_minor, q.total_minor],
      c,
    );
    await c.query(`INSERT INTO booking_events (booking_id, to_status, actor_id, note) VALUES ($1,'pending',$2,'Booking created')`, [b.id, customer.id]);
    return b;
  });
  await notifyProvidersOfRequest(booking);
  return booking;
}

async function notifyProvidersOfRequest(b: any) {
  const svc = await one('SELECT name FROM services WHERE id = $1', [b.service_id]);
  const targets = await query(
    `SELECT DISTINCT u.phone FROM providers p JOIN users u ON u.id = p.owner_user_id
       JOIN provider_zones pz ON pz.provider_id = p.id AND pz.zone_id = $1
       JOIN provider_services ps ON ps.provider_id = p.id AND ps.service_id = $2
      WHERE p.status = 'active' AND p.is_available AND ($3::uuid IS NULL OR p.id = $3)
      ORDER BY u.phone LIMIT 25`,
    [b.zone_id, b.service_id, b.provider_id],
  );
  const area = b.address?.area ?? '';
  for (const t of targets) {
    await sendSms(t.phone, `FixAm new job ${b.code}: ${svc?.name} in ${area}, ${formatLeone(b.total_minor)}${b.surcharge_minor > 0 ? ' (peak rate)' : ''}. Open the app to accept.`);
  }
}

function isProviderSide(user: AuthUser, b: any) {
  return !!user.providerId && b.provider_id === user.providerId && (user.role === 'provider' || user.servicemanId === b.serviceman_id);
}

export async function acceptBooking(user: AuthUser, bookingId: string) {
  if (user.role !== 'provider' || !user.providerId) throw forbidden('Only providers can accept jobs');
  const providerId = user.providerId;
  const result = await tx(async (c) => {
    const b = await lockBooking(c, bookingId);
    if (b.status !== 'pending') throw conflict('already_taken', 'Another provider already took this job');
    if (b.provider_id && b.provider_id !== providerId) throw forbidden('This booking was made with another provider');
    const offers = await one(
      `SELECT 1 FROM provider_services ps JOIN provider_zones pz ON pz.provider_id = ps.provider_id
        WHERE ps.provider_id = $1 AND ps.service_id = $2 AND pz.zone_id = $3`,
      [providerId, b.service_id, b.zone_id],
      c,
    );
    if (!offers) throw forbidden('You do not offer this service in this zone');
    const blockers = await acceptBlockers(providerId, c);
    if (blockers.length) throw conflict('cannot_accept', 'Resolve these before accepting jobs', { blockers });
    await c.query('UPDATE bookings SET provider_id = $2, accepted_at = now() WHERE id = $1', [b.id, providerId]);
    await transition(c, b, 'accepted', user.id);
    return b;
  });
  const p = await one('SELECT business_name FROM providers WHERE id = $1', [providerId]);
  const customer = await one('SELECT phone FROM users WHERE id = $1', [result.customer_id]);
  await sendSms(customer.phone, `FixAm: ${p.business_name} accepted booking ${result.code}. Your start code is ${bookingCode(result.id, 'start')} - give it to the handyman only when they arrive.`);
  return getBooking(user, bookingId);
}

export async function assignServiceman(user: AuthUser, bookingId: string, servicemanId: string) {
  if (user.role !== 'provider') throw forbidden();
  await tx(async (c) => {
    const b = await lockBooking(c, bookingId);
    if (b.provider_id !== user.providerId) throw notFound('Booking');
    const s = await one('SELECT id FROM servicemen WHERE id = $1 AND provider_id = $2 AND active', [servicemanId, user.providerId], c);
    if (!s) throw notFound('Serviceman');
    if (b.status === 'assigned') {
      // Re-assignment keeps the status; just record it.
      await c.query('UPDATE bookings SET serviceman_id = $2 WHERE id = $1', [b.id, servicemanId]);
      await c.query(`INSERT INTO booking_events (booking_id, from_status, to_status, actor_id, note) VALUES ($1,'assigned','assigned',$2,'Reassigned')`, [b.id, user.id]);
    } else {
      await c.query('UPDATE bookings SET serviceman_id = $2 WHERE id = $1', [b.id, servicemanId]);
      await transition(c, b, 'assigned', user.id);
    }
  });
  return getBooking(user, bookingId);
}

export async function markEnRoute(user: AuthUser, bookingId: string) {
  await tx(async (c) => {
    const b = await lockBooking(c, bookingId);
    if (!isProviderSide(user, b)) throw notFound('Booking');
    await transition(c, b, 'en_route', user.id);
  });
  const b = await one('SELECT b.code, u.phone FROM bookings b JOIN users u ON u.id = b.customer_id WHERE b.id = $1', [bookingId]);
  await sendSms(b.phone, `FixAm: your handyman for ${b.code} is on the way.`);
  return getBooking(user, bookingId);
}

export async function startJob(user: AuthUser, bookingId: string, code: string) {
  await tx(async (c) => {
    const b = await lockBooking(c, bookingId);
    if (!isProviderSide(user, b)) throw notFound('Booking');
    if (!safeEqual(code, bookingCode(b.id, 'start'))) throw badRequest('wrong_code', 'Wrong start code. Ask the customer for the code in their app or SMS.');
    await transition(c, b, 'in_progress', user.id, 'Start code verified', { started_at: new Date() });
  });
  const b = await one('SELECT b.id, b.code, u.phone FROM bookings b JOIN users u ON u.id = b.customer_id WHERE b.id = $1', [bookingId]);
  await sendSms(b.phone, `FixAm: job ${b.code} started. When the work is done and you are happy, give the handyman completion code ${bookingCode(b.id, 'complete')}.`);
  return getBooking(user, bookingId);
}

export async function completeJob(user: AuthUser, bookingId: string, code: string) {
  const b0 = await tx(async (c) => {
    const b = await lockBooking(c, bookingId);
    if (!isProviderSide(user, b)) throw notFound('Booking');
    if (!safeEqual(code, bookingCode(b.id, 'complete'))) throw badRequest('wrong_code', 'Wrong completion code');
    await transition(c, b, 'completed', user.id, 'Completion code verified', { completed_at: new Date() });
    await c.query('UPDATE providers SET completed_jobs = completed_jobs + 1 WHERE id = $1', [b.provider_id]);
    await settleBooking(b.id, c); // cash: debits commission now; digital: credits earning once paid
    return b;
  });
  await evaluatePerformanceBadges(b0.provider_id);
  const b = await one('SELECT b.*, u.phone FROM bookings b JOIN users u ON u.id = b.customer_id WHERE b.id = $1', [bookingId]);
  if (b.payment_method !== 'cash' && b.payment_status !== 'paid') {
    await sendSms(b.phone, `FixAm: job ${b.code} is complete. Please pay ${formatLeone(b.total_minor)} in the app or dial the FixAm USSD menu.`);
  } else {
    await sendSms(b.phone, `FixAm: job ${b.code} is complete. Tenki! Rate your handyman in the app.`);
  }
  return getBooking(user, bookingId);
}

export async function cancelBooking(user: AuthUser, bookingId: string, reason: string) {
  await tx(async (c) => {
    const b = await lockBooking(c, bookingId);
    const isCustomer = b.customer_id === user.id;
    const isAdmin = user.role === 'admin';
    const isProvider = user.role === 'provider' && b.provider_id === user.providerId;
    if (!isCustomer && !isAdmin && !isProvider) throw notFound('Booking');
    if (!isAdmin && ['in_progress', 'completed', 'disputed'].includes(b.status)) {
      throw conflict('cannot_cancel', 'Work has started. Open a dispute instead.');
    }
    if (isProvider && !isAdmin && b.status !== 'pending') {
      // A provider backing out of an accepted job counts against their reliability.
      // Broadcast jobs go back to the open pool; jobs booked directly with this provider are cancelled.
      await c.query('UPDATE providers SET cancelled_jobs = cancelled_jobs + 1 WHERE id = $1', [b.provider_id]);
      const quote = await one('SELECT provider_id FROM price_quotes WHERE id = $1', [b.quote_id], c);
      if (!quote?.provider_id) {
        await c.query(`UPDATE bookings SET status = 'pending', provider_id = NULL, serviceman_id = NULL, accepted_at = NULL WHERE id = $1`, [b.id]);
        await c.query(`INSERT INTO booking_events (booking_id, from_status, to_status, actor_id, note) VALUES ($1,$2,'pending',$3,$4)`, [
          b.id, b.status, user.id, `Provider withdrew: ${reason}`,
        ]);
        return;
      }
    }
    // An admin may cancel a disputed or completed job; undo its settlement first so nobody keeps money for it.
    if (b.settled_at) await reverseSettlement(c, b.id, `Cancelled: ${reason}`);
    await transition(c, b, 'cancelled', user.id, reason, { cancelled_at: new Date(), cancel_reason: reason });
    await refundBookingToWallet(b.id, reason, c);
  });
  if (user.role === 'provider') await evaluatePerformanceBadges(user.providerId!);
  return getBooking(user, bookingId);
}

export async function openDispute(user: AuthUser, bookingId: string, reason: string) {
  await tx(async (c) => {
    const b = await lockBooking(c, bookingId);
    if (b.customer_id !== user.id) throw notFound('Booking');
    if (b.status === 'completed' && b.completed_at && Date.now() - new Date(b.completed_at).getTime() > 72 * 3600_000) {
      throw conflict('dispute_window_closed', 'Disputes must be opened within 72 hours of completion');
    }
    await transition(c, b, 'disputed', user.id, reason, { disputed_at: new Date(), dispute_reason: reason });
  });
  return getBooking(user, bookingId);
}

/** Admin decision on a dispute: release to the provider, or cancel and refund the customer's wallet. */
export async function resolveDispute(admin: AuthUser, bookingId: string, resolution: 'release' | 'refund', note: string) {
  await tx(async (c) => {
    const b = await lockBooking(c, bookingId);
    if (b.status !== 'disputed') throw conflict('not_disputed', 'Booking is not in dispute');
    if (resolution === 'release') {
      await transition(c, b, 'completed', admin.id, note, { completed_at: b.completed_at ?? new Date() });
      if (!b.completed_at) await c.query('UPDATE providers SET completed_jobs = completed_jobs + 1 WHERE id = $1', [b.provider_id]);
      await settleBooking(b.id, c);
      return;
    }
    if (b.settled_at) await reverseSettlement(c, b.id, 'Dispute refund');
    await transition(c, b, 'cancelled', admin.id, note, { cancelled_at: new Date(), cancel_reason: note });
    await refundBookingToWallet(b.id, `Dispute: ${note}`, c);
  });
  return getBooking(admin, bookingId);
}

export async function getBooking(user: AuthUser, bookingId: string) {
  const b = await one(
    `SELECT b.*, s.name AS service_name, s.category_id, z.name AS zone_name,
            p.business_name AS provider_name, p.rating_avg AS provider_rating, pu.phone AS provider_phone,
            su.name AS serviceman_name, su.phone AS serviceman_phone, cu.name AS customer_name, cu.phone AS customer_phone,
            q.breakdown AS price_breakdown, r.rating AS review_rating
       FROM bookings b JOIN services s ON s.id = b.service_id JOIN zones z ON z.id = b.zone_id
       JOIN price_quotes q ON q.id = b.quote_id JOIN users cu ON cu.id = b.customer_id
       LEFT JOIN providers p ON p.id = b.provider_id LEFT JOIN users pu ON pu.id = p.owner_user_id
       LEFT JOIN servicemen sm ON sm.id = b.serviceman_id LEFT JOIN users su ON su.id = sm.user_id
       LEFT JOIN reviews r ON r.booking_id = b.id
      WHERE b.id = $1`,
    [bookingId],
  );
  if (!b) throw notFound('Booking');
  const isCustomer = b.customer_id === user.id;
  const isAdmin = user.role === 'admin';
  const isOwnerProvider = user.role === 'provider' && b.provider_id === user.providerId;
  const isAssignedServiceman = !!user.servicemanId && b.serviceman_id === user.servicemanId;
  // An open request is visible only to providers who offer this service in this zone (the same set that gets the SMS).
  const isOpenRequest =
    user.role === 'provider' && b.status === 'pending' && !b.provider_id && !!user.providerId &&
    !!(await one(
      `SELECT 1 FROM provider_services ps JOIN provider_zones pz ON pz.provider_id = ps.provider_id
        WHERE ps.provider_id = $1 AND ps.service_id = $2 AND pz.zone_id = $3`,
      [user.providerId, b.service_id, b.zone_id],
    ));
  if (!isCustomer && !isAdmin && !isOwnerProvider && !isAssignedServiceman && !isOpenRequest) throw notFound('Booking');

  const events = await query('SELECT from_status, to_status, note, created_at FROM booking_events WHERE booking_id = $1 ORDER BY id', [b.id]);
  const out: any = { ...b, events };
  if (isCustomer && !['completed', 'cancelled'].includes(b.status)) {
    out.start_code = bookingCode(b.id, 'start');
    out.completion_code = b.status === 'in_progress' || b.status === 'disputed' ? bookingCode(b.id, 'complete') : null;
  }
  // Until a provider accepts (including a job booked directly with them), hide the customer's phone and exact address.
  if (!isCustomer && !isAdmin && b.status === 'pending') {
    out.customer_phone = null;
    out.address = { area: b.address?.area, landmark: b.address?.landmark };
  }
  // Commission internals are for the platform and the provider.
  if (!isAdmin && !isOwnerProvider) {
    delete out.commission_minor;
    delete out.commission_gst_minor;
    delete out.provider_earning_minor;
    delete out.commission_snapshot;
  }
  return out;
}

export async function listBookings(user: AuthUser, scope: 'customer' | 'provider' | 'serviceman' | 'requests' | 'all', status: string | null, limit: number, offset: number) {
  const base = `SELECT b.id, b.code, b.provider_id, b.status, b.payment_status, b.payment_method, b.scheduled_at, b.total_minor, b.surcharge_minor,
                       b.is_emergency, b.address->>'area' AS area, b.address->>'landmark' AS landmark, b.created_at,
                       s.name AS service_name, z.name AS zone_name, p.business_name AS provider_name
                  FROM bookings b JOIN services s ON s.id = b.service_id JOIN zones z ON z.id = b.zone_id
                  LEFT JOIN providers p ON p.id = b.provider_id`;
  const tail = `AND ($2::text IS NULL OR b.status = $2) ORDER BY b.scheduled_at DESC LIMIT $3 OFFSET $4`;
  switch (scope) {
    case 'customer':
      return query(`${base} WHERE b.customer_id = $1 ${tail}`, [user.id, status, limit, offset]);
    case 'provider':
      if (user.role !== 'provider') throw forbidden();
      return query(`${base} WHERE b.provider_id = $1 ${tail}`, [user.providerId, status, limit, offset]);
    case 'serviceman':
      if (!user.servicemanId) throw forbidden();
      return query(`${base} WHERE b.serviceman_id = $1 ${tail}`, [user.servicemanId, status, limit, offset]);
    case 'requests':
      // Open jobs this provider could take: their zones, their services, nobody has accepted yet.
      if (user.role !== 'provider') throw forbidden();
      return query(
        `${base} WHERE b.status = 'pending' AND (b.provider_id IS NULL OR b.provider_id = $1)
            AND EXISTS (SELECT 1 FROM provider_zones pz WHERE pz.provider_id = $1 AND pz.zone_id = b.zone_id)
            AND EXISTS (SELECT 1 FROM provider_services ps WHERE ps.provider_id = $1 AND ps.service_id = b.service_id)
            ${tail.replace('b.scheduled_at DESC', 'b.is_emergency DESC, b.scheduled_at')}`,
        [user.providerId, status, limit, offset],
      );
    case 'all':
      if (user.role !== 'admin') throw forbidden();
      return query(`${base} WHERE $1::uuid IS NULL ${tail}`, [null, status, limit, offset]);
  }
}
