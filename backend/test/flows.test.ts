import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one, query } from '../src/db.js';
import { bookingCode } from '../src/modules/bookings/bookings.service.js';
import { signPayload, SIGNATURE_HEADER } from '../src/modules/payments/gateways/signing.js';
import { setSetting } from '../src/modules/settings/settings.service.js';
import { api, auth, closePool, eveningSlot, freshDb, ids, loginAdmin, loginOtp, offPeakSlot, V } from './helpers.js';

let customer: { token: string; user: any };
let electrician: { token: string; user: any };
let plumber: { token: string; user: any };
let serviceman: { token: string; user: any };
let adminToken: string;
let central: string;
let westEnd: string;
let faultRepair: string;
let leakRepair: string;
let brightSpark: string;

beforeAll(async () => {
  await freshDb();
  const i = await ids();
  central = await i.zone('Freetown - Central');
  westEnd = await i.zone('Freetown - West End');
  faultRepair = await i.service('Electrical fault finding & repair');
  leakRepair = await i.service('Fix leaking pipe or tap');
  brightSpark = await i.provider('Bright Spark Electrical');
  customer = await loginOtp('076111111');
  electrician = await loginOtp('077222222');
  plumber = await loginOtp('076333333');
  serviceman = await loginOtp('078444444');
  adminToken = await loginAdmin();
});

afterAll(closePool);

async function quote(serviceId: string, zoneId: string, at: Date, extra: Record<string, unknown> = {}) {
  const r = await api().post(`${V}/pricing/quote`).set(auth(customer.token)).send({ serviceId, zoneId, scheduledAt: at.toISOString(), ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

async function book(serviceId: string, zoneId: string, paymentMethod: string, at = offPeakSlot(), extra: Record<string, unknown> = {}) {
  const q = await quote(serviceId, zoneId, at, extra);
  const r = await api()
    .post(`${V}/bookings`)
    .set(auth(customer.token))
    .send({ quoteId: q.id, paymentMethod, address: { area: 'Tower Hill', landmark: 'Opposite the Parliament gate, green door' } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

async function runJob(token: string, bookingId: string) {
  expect((await api().post(`${V}/bookings/${bookingId}/en-route`).set(auth(token))).status).toBe(200);
  const s = await api().post(`${V}/bookings/${bookingId}/start`).set(auth(token)).send({ code: bookingCode(bookingId, 'start') });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  const c = await api().post(`${V}/bookings/${bookingId}/complete`).set(auth(token)).send({ code: bookingCode(bookingId, 'complete') });
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  return c.body;
}

async function pay(bookingId: string, gateway: string, msisdn: string, key = `k-${bookingId}`) {
  const r = await api().post(`${V}/payments`).set(auth(customer.token)).set('Idempotency-Key', key).send({ purpose: 'booking', bookingId, gateway, msisdn });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

describe('auth', () => {
  it('rejects a wrong OTP and locks after too many attempts', async () => {
    await api().post(`${V}/auth/otp/request`).send({ phone: '076999001' });
    const bad = await api().post(`${V}/auth/otp/verify`).send({ phone: '076999001', code: '000000' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toMatch(/otp_invalid|otp_expired/);
  });

  it('rate-limits OTP requests', async () => {
    for (let i = 0; i < 3; i++) await api().post(`${V}/auth/otp/request`).send({ phone: '076999002' });
    const r = await api().post(`${V}/auth/otp/request`).send({ phone: '076999002' });
    expect(r.status).toBe(429);
  });

  it('refresh tokens rotate and cannot be reused', async () => {
    const o = await api().post(`${V}/auth/otp/request`).send({ phone: '076999003' });
    const v = await api().post(`${V}/auth/otp/verify`).send({ phone: '076999003', code: o.body.devCode });
    const r1 = await api().post(`${V}/auth/refresh`).send({ refreshToken: v.body.refreshToken });
    expect(r1.status).toBe(200);
    const r2 = await api().post(`${V}/auth/refresh`).send({ refreshToken: v.body.refreshToken });
    expect(r2.status).toBe(401);
  });

  it('protects admin routes', async () => {
    expect((await api().get(`${V}/admin/dashboard`).set(auth(customer.token))).status).toBe(403);
    expect((await api().get(`${V}/admin/dashboard`).set(auth(adminToken))).status).toBe(200);
  });
});

describe('peak-hour pricing', () => {
  it('quotes the base price off-peak and adds the evening surcharge at peak', async () => {
    const off = await quote(faultRepair, central, offPeakSlot());
    expect(off.surcharge_minor).toBe(0);
    expect(off.total_minor).toBe(25000);
    const peak = await quote(faultRepair, central, eveningSlot());
    expect(peak.surcharge_minor).toBe(6300);
    expect(peak.breakdown.appliedRules[0].label).toBe('Evening peak');
  });

  it('stacks the urgent fee', async () => {
    const q = await quote(faultRepair, central, eveningSlot(), { isEmergency: true });
    expect(q.multiplier).toBe(1.5);
    expect(q.surcharge_minor).toBe(12500 + 10000);
  });

  it('serves an hour-by-hour curve that marks the cheapest hours', async () => {
    const date = offPeakSlot().toISOString().slice(0, 10);
    const r = await api().get(`${V}/pricing/day-curve`).query({ serviceId: faultRepair, zoneId: central, date });
    expect(r.status).toBe(200);
    const h18 = r.body.hours.find((h: any) => h.hour === 18);
    const h10 = r.body.hours.find((h: any) => h.hour === 10);
    expect(h18.totalMinor).toBeGreaterThan(h10.totalMinor);
    expect(h10.isCheapest).toBe(true);
  });

  it('lets admins create rules and respects the multiplier cap setting', async () => {
    const r = await api()
      .post(`${V}/pricing/rules`)
      .set(auth(adminToken))
      .send({ name: 'Central all-day test', label: 'Test surge', kind: 'time_window', zoneId: central, multiplier: 3, priority: 99 });
    expect(r.status).toBe(201);
    const q = await quote(faultRepair, central, offPeakSlot());
    expect(q.multiplier).toBe(1.75);
    expect(q.breakdown.cappedBy).toBe('max_multiplier');
    await api().delete(`${V}/pricing/rules/${r.body.id}`).set(auth(adminToken));
  });

  it('rejects expired or reused quotes', async () => {
    const q = await quote(faultRepair, central, offPeakSlot());
    await query(`UPDATE price_quotes SET expires_at = now() - interval '1 minute' WHERE id = $1`, [q.id]);
    const r = await api().post(`${V}/bookings`).set(auth(customer.token)).send({ quoteId: q.id, paymentMethod: 'cash', address: { area: 'x1', landmark: 'y1' } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('quote_expired');
  });
});

describe('mobile money booking flow', () => {
  it('books, pays with Orange Money (idempotently), completes, and settles commission + GST', async () => {
    const booking = await book(faultRepair, central, 'orange_money');
    expect(booking.status).toBe('pending');
    expect(booking.start_code).toMatch(/^\d{4}$/);
    expect(booking.commission_minor).toBeUndefined(); // hidden from customers

    const p1 = await pay(booking.id, 'orange_money', '076111111');
    expect(p1.status).toBe('pending');
    expect(p1.customer_action.type).toBe('approve_on_phone');
    const p2 = await pay(booking.id, 'orange_money', '076111111'); // same Idempotency-Key = retry after a timeout
    expect(p2.id).toBe(p1.id);

    const sim = await api().post(`${V}/payments/${p1.id}/simulate`).set(auth(customer.token)).send({});
    expect(sim.status).toBe(200);
    expect(sim.body.payment.status).toBe('succeeded');
    expect((await one('SELECT payment_status FROM bookings WHERE id = $1', [booking.id])).payment_status).toBe('paid');

    const accept = await api().post(`${V}/bookings/${booking.id}/accept`).set(auth(electrician.token));
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    const done = await runJob(electrician.token, booking.id);
    expect(done.status).toBe('completed');

    // Bright Spark is on the standard plan: 15% commission, provider bears 15% GST on it.
    expect(done.commission_minor).toBe(3750);
    expect(done.commission_gst_minor).toBe(563);
    expect(done.provider_earning_minor).toBe(25000 - 3750 - 563);
    const ledger = await query('SELECT account_type, entry_type, amount_minor FROM ledger_entries WHERE booking_id = $1 ORDER BY id', [booking.id]);
    expect(ledger).toEqual([
      { account_type: 'provider', entry_type: 'job_earning', amount_minor: 20687 },
      { account_type: 'platform_revenue', entry_type: 'commission', amount_minor: 3750 },
      { account_type: 'platform_tax', entry_type: 'commission_gst', amount_minor: 563 },
    ]);

    const review = await api().post(`${V}/reviews`).set(auth(customer.token)).send({ bookingId: booking.id, rating: 5, comment: 'Fast and tidy' });
    expect(review.status).toBe(201);
    const dup = await api().post(`${V}/reviews`).set(auth(customer.token)).send({ bookingId: booking.id, rating: 1 });
    expect(dup.status).toBe(409);
  });

  it('settles when payment arrives after completion (pay-after-job)', async () => {
    const booking = await book(faultRepair, central, 'afrimoney');
    await api().post(`${V}/bookings/${booking.id}/accept`).set(auth(electrician.token));
    await runJob(electrician.token, booking.id);
    expect((await one('SELECT settled_at FROM bookings WHERE id = $1', [booking.id])).settled_at).toBeNull();
    const p = await pay(booking.id, 'afrimoney', '077111112');
    await api().post(`${V}/payments/${p.id}/simulate`).set(auth(customer.token)).send({});
    expect((await one('SELECT settled_at FROM bookings WHERE id = $1', [booking.id])).settled_at).not.toBeNull();
  });

  it('refuses a wallet on the wrong SIM network and suggests the right one', async () => {
    const booking = await book(faultRepair, central, 'orange_money');
    const r = await api().post(`${V}/payments`).set(auth(customer.token)).set('Idempotency-Key', 'mismatch-1').send({ purpose: 'booking', bookingId: booking.id, gateway: 'orange_money', msisdn: '077123456' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('wallet_network_mismatch');
    expect(r.body.error.details.suggestedGateway).toBe('afrimoney');
  });

  it('requires an Idempotency-Key and rejects reuse with different parameters', async () => {
    const booking = await book(faultRepair, central, 'orange_money');
    const none = await api().post(`${V}/payments`).set(auth(customer.token)).send({ purpose: 'booking', bookingId: booking.id, gateway: 'orange_money' });
    expect(none.status).toBe(400);
    await api().post(`${V}/payments`).set(auth(customer.token)).set('Idempotency-Key', 'reuse-key-1').send({ purpose: 'wallet_topup', amountMinor: 10000, gateway: 'orange_money', msisdn: '076111111' });
    const reuse = await api().post(`${V}/payments`).set(auth(customer.token)).set('Idempotency-Key', 'reuse-key-1').send({ purpose: 'wallet_topup', amountMinor: 20000, gateway: 'orange_money', msisdn: '076111111' });
    expect(reuse.status).toBe(409);
  });

  it('handles a declined payment and lets the customer retry with another wallet', async () => {
    const booking = await book(faultRepair, central, 'qmoney');
    const p = await pay(booking.id, 'qmoney', '031111000', 'decline-1'); // ...000 = declined in sandbox
    const sim = await api().post(`${V}/payments/${p.id}/simulate`).set(auth(customer.token)).send({});
    expect(sim.body.payment.status).toBe('failed');
    expect(sim.body.payment.failure_reason).toBe('insufficient_funds');
    expect((await one('SELECT payment_status FROM bookings WHERE id = $1', [booking.id])).payment_status).toBe('unpaid');
    const retry = await pay(booking.id, 'monime', '031111222', 'decline-retry-1');
    expect(retry.customer_action.type).toBe('dial_ussd');
    expect(retry.customer_action.paymentCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('verifies webhook signatures and ignores duplicates', async () => {
    const booking = await book(faultRepair, central, 'orange_money');
    const p = await pay(booking.id, 'orange_money', '076111111', 'webhook-test-1');
    const body = JSON.stringify({ event_id: 'evt-dup-1', reference: p.external_ref, status: 'succeeded' });

    const forged = await api().post(`${V}/webhooks/payments/orange_money`).set(SIGNATURE_HEADER, signPayload('wrong-secret', body)).set('Content-Type', 'application/json').send(body);
    expect(forged.status).toBe(401);
    const stale = await api().post(`${V}/webhooks/payments/orange_money`).set(SIGNATURE_HEADER, signPayload('sandbox-webhook-secret', body, Math.floor(Date.now() / 1000) - 3600)).set('Content-Type', 'application/json').send(body);
    expect(stale.status).toBe(401);

    const ok = await api().post(`${V}/webhooks/payments/orange_money`).set(SIGNATURE_HEADER, signPayload('sandbox-webhook-secret', body)).set('Content-Type', 'application/json').send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.result).toBe('applied:succeeded');
    const again = await api().post(`${V}/webhooks/payments/orange_money`).set(SIGNATURE_HEADER, signPayload('sandbox-webhook-secret', body)).set('Content-Type', 'application/json').send(body);
    expect(again.body.duplicate).toBe(true);

    // A late "failed" event for the same payment cannot undo a success.
    const late = JSON.stringify({ event_id: 'evt-late-1', reference: p.external_ref, status: 'failed' });
    const lateRes = await api().post(`${V}/webhooks/payments/orange_money`).set(SIGNATURE_HEADER, signPayload('sandbox-webhook-secret', late)).set('Content-Type', 'application/json').send(late);
    expect(lateRes.body.result).toBe('ignored_final');
    expect((await one('SELECT status FROM payments WHERE id = $1', [p.id])).status).toBe('succeeded');
  });

  it('refunds a paid booking to the wallet on cancellation, and the wallet can pay the next job', async () => {
    const booking = await book(faultRepair, central, 'orange_money');
    const p = await pay(booking.id, 'orange_money', '076111111', 'refund-1');
    await api().post(`${V}/payments/${p.id}/simulate`).set(auth(customer.token)).send({});
    const before = (await api().get(`${V}/wallet`).set(auth(customer.token))).body.balance_minor;
    const c = await api().post(`${V}/bookings/${booking.id}/cancel`).set(auth(customer.token)).send({ reason: 'Fixed it myself' });
    expect(c.status).toBe(200);
    expect(c.body.payment_status).toBe('refunded');
    const after = (await api().get(`${V}/wallet`).set(auth(customer.token))).body.balance_minor;
    expect(after - before).toBe(booking.total_minor);

    const next = await book(faultRepair, central, 'wallet');
    const wp = await pay(next.id, 'wallet', '076111111', 'wallet-pay-1');
    expect(wp.status).toBe('succeeded');
    expect((await api().get(`${V}/wallet`).set(auth(customer.token))).body.balance_minor).toBe(after - next.total_minor);
  });
});

describe('cash jobs and the commission-owed limit', () => {
  it('debits commission on cash jobs, blocks new jobs above the limit, and clears after settlement', async () => {
    await setSetting('cash.max_commission_due_minor', 5000); // Le 50 for the test
    const booking = await book(leakRepair, westEnd, 'cash');
    const acc = await api().post(`${V}/bookings/${booking.id}/accept`).set(auth(plumber.token));
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);

    // The plumbing company assigns its serviceman, who does the job.
    const team = await api().get(`${V}/providers/me/servicemen`).set(auth(plumber.token));
    const assign = await api().post(`${V}/bookings/${booking.id}/assign`).set(auth(plumber.token)).send({ servicemanId: team.body[0].id });
    expect(assign.body.status).toBe('assigned');
    const mine = await api().get(`${V}/bookings?scope=serviceman`).set(auth(serviceman.token));
    expect(mine.body.map((b: any) => b.id)).toContain(booking.id);
    expect((await api().post(`${V}/bookings/${booking.id}/en-route`).set(auth(serviceman.token))).status).toBe(200);
    const wrongCode = bookingCode(booking.id, 'start') === '0000' ? '1111' : '0000';
    const badStart = await api().post(`${V}/bookings/${booking.id}/start`).set(auth(serviceman.token)).send({ code: wrongCode });
    expect(badStart.status).toBe(400);
    await api().post(`${V}/bookings/${booking.id}/start`).set(auth(serviceman.token)).send({ code: bookingCode(booking.id, 'start') });
    const done = await api().post(`${V}/bookings/${booking.id}/complete`).set(auth(serviceman.token)).send({ code: bookingCode(booking.id, 'complete') });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');

    // Salone Plumbing is on the Growth plan but has no active subscription, so it pays the 15% default.
    const wallet = await api().get(`${V}/wallet`).set(auth(plumber.token));
    expect(wallet.body.commission_owed_minor).toBe(3000 + 450); // 15% of Le 200 + 15% GST
    const me = await api().get(`${V}/providers/me`).set(auth(plumber.token));
    expect(me.body.can_accept_jobs).toBe(true); // Le 34.50 owed, under the Le 50 limit

    const second = await book(leakRepair, westEnd, 'cash');
    await api().post(`${V}/bookings/${second.id}/accept`).set(auth(plumber.token));
    await runJob(plumber.token, second.id);
    const blocked = await api().get(`${V}/providers/me`).set(auth(plumber.token));
    expect(blocked.body.accept_blockers).toContain('cash_commission_limit_exceeded');
    const third = await book(leakRepair, westEnd, 'cash');
    const refused = await api().post(`${V}/bookings/${third.id}/accept`).set(auth(plumber.token));
    expect(refused.status).toBe(409);

    const settle = await api().post(`${V}/payments`).set(auth(plumber.token)).set('Idempotency-Key', 'settle-1').send({ purpose: 'cash_settlement', gateway: 'orange_money', msisdn: '076333333' });
    expect(settle.status, JSON.stringify(settle.body)).toBe(201);
    expect(settle.body.amount_minor).toBe(6900);
    await api().post(`${V}/payments/${settle.body.id}/simulate`).set(auth(plumber.token)).send({});
    const cleared = await api().get(`${V}/providers/me`).set(auth(plumber.token));
    expect(cleared.body.commission_owed_minor).toBe(0);
    expect(cleared.body.can_accept_jobs).toBe(true);
    expect((await api().post(`${V}/bookings/${third.id}/accept`).set(auth(plumber.token))).status).toBe(200);
    await setSetting('cash.max_commission_due_minor', 200000);
  });
});

describe('subscription commission model', () => {
  it('charges 0% to a provider with an active Pro subscription', async () => {
    const solar = await loginOtp('076555555');
    const svc = (await one(`SELECT id FROM services WHERE name = 'Generator servicing'`)).id;
    const booking = await book(svc, central, 'cash');
    await api().post(`${V}/bookings/${booking.id}/accept`).set(auth(solar.token));
    const done = await runJob(solar.token, booking.id);
    expect(done.commission_minor).toBe(0);
    expect(done.commission_snapshot.rateSource).toBe('subscription');
  });

  it('activates a subscription when its mobile money payment succeeds', async () => {
    const plan = (await one(`SELECT id, subscription_fee_minor FROM commission_plans WHERE code = 'growth'`));
    const r = await api().post(`${V}/payments`).set(auth(plumber.token)).set('Idempotency-Key', 'subscription-test-1').send({ purpose: 'subscription', planId: plan.id, gateway: 'orange_money', msisdn: '076333333' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.amount_minor).toBe(plan.subscription_fee_minor);
    await api().post(`${V}/payments/${r.body.id}/simulate`).set(auth(plumber.token)).send({});
    const me = await api().get(`${V}/providers/me`).set(auth(plumber.token));
    expect(me.body.active_subscription).not.toBeNull();
    const preview = await api().get(`${V}/providers/me/commission-preview`).set(auth(plumber.token)).query({ serviceId: leakRepair, subtotalMinor: 100000 });
    expect(preview.body).toMatchObject({ rateBps: 800, rateSource: 'subscription', commissionMinor: 8000 });
  });
});

describe('authentication badges', () => {
  it('gates job acceptance on the ID badge, then lets an approved provider work', async () => {
    const newbie = await loginOtp('076888001', 'Sorie Kamara');
    const reg = await api().post(`${V}/providers/register`).set(auth(newbie.token)).send({
      businessName: 'Sorie Tiles', zoneIds: [central], services: [{ serviceId: faultRepair, priceOverrideMinor: 22000 }],
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    await api().post(`${V}/providers/${reg.body.id}/status`).set(auth(adminToken)).send({ status: 'active' });
    const me1 = await api().get(`${V}/providers/me`).set(auth(newbie.token));
    expect(me1.body.accept_blockers).toEqual(['missing_badge:NATIONAL_ID']);
    expect(me1.body.badges.map((b: any) => b.badge_code)).toContain('PHONE_VERIFIED');

    const missing = await api().post(`${V}/badges/apply`).set(auth(newbie.token)).send({ badgeCode: 'NATIONAL_ID', documents: [{ type: 'id_document', url: '/x.jpg' }] });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.missing).toEqual(['selfie']);

    const upload = await api().post(`${V}/uploads`).set(auth(newbie.token)).set('Content-Type', 'image/png').send(Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(upload.status).toBe(201);
    const apply = await api().post(`${V}/badges/apply`).set(auth(newbie.token)).send({
      badgeCode: 'NATIONAL_ID', documents: [{ type: 'id_document', url: upload.body.url, number: 'SL-1234567' }, { type: 'selfie', url: upload.body.url }],
    });
    expect(apply.status).toBe(201);
    expect((await api().post(`${V}/badges/apply`).set(auth(newbie.token)).send({ badgeCode: 'NATIONAL_ID', documents: apply.body.documents })).status).toBe(409);
    expect((await api().get(`${V}${upload.body.url.replace('/api/v1', '')}`).set(auth(customer.token))).status).toBe(404); // documents are private
    expect((await api().get(`${V}${upload.body.url.replace('/api/v1', '')}`).set(auth(adminToken))).status).toBe(200);

    const queue = await api().get(`${V}/badges/applications`).set(auth(adminToken));
    expect(queue.body.map((a: any) => a.id)).toContain(apply.body.id);
    expect((await api().post(`${V}/badges/applications/${apply.body.id}/review`).set(auth(adminToken)).send({ decision: 'reject' })).status).toBe(400); // note required
    const approved = await api().post(`${V}/badges/applications/${apply.body.id}/review`).set(auth(adminToken)).send({ decision: 'approve' });
    expect(approved.body.status).toBe('approved');
    expect(approved.body.expires_at).not.toBeNull();

    const me2 = await api().get(`${V}/providers/me`).set(auth(newbie.token));
    expect(me2.body.can_accept_jobs).toBe(true);
    expect(me2.body.trust_score).toBe(30); // phone 5 + ID 25

    const check = await api().get(`${V}/badges/verify/${apply.body.verification_code.toLowerCase()}`);
    expect(check.body).toMatchObject({ valid: true, badge: 'ID verified', provider: 'Sorie Tiles' });

    await api().post(`${V}/badges/${apply.body.id}/revoke`).set(auth(adminToken)).send({ note: 'Document found to be forged' });
    expect((await api().get(`${V}/badges/verify/${apply.body.verification_code}`)).body).toMatchObject({ valid: false, reason: 'revoked' });
    expect((await api().get(`${V}/badges/verify/FXB-NOPE00`)).body).toMatchObject({ valid: false, reason: 'unknown_code' });
  });

  it('awards performance badges automatically from job history', async () => {
    await query(`UPDATE providers SET completed_jobs = 99, rating_avg = 4.9, rating_count = 25 WHERE id = $1`, [brightSpark]);
    const booking = await book(faultRepair, central, 'cash');
    await api().post(`${V}/bookings/${booking.id}/accept`).set(auth(electrician.token));
    await runJob(electrician.token, booking.id);
    const badges = await api().get(`${V}/badges/mine`).set(auth(electrician.token));
    const approved = badges.body.filter((b: any) => b.status === 'approved').map((b: any) => b.badge_code);
    expect(approved).toEqual(expect.arrayContaining(['VETERAN', 'TOP_RATED', 'RELIABLE']));
    const search = await api().get(`${V}/providers`).query({ zoneId: central, serviceId: faultRepair, badge: 'TOP_RATED' });
    expect(search.body[0].business_name).toBe('Bright Spark Electrical');
  });
});

describe('payouts', () => {
  it('holds funds on request, pays through the sandbox on approval, and reverses on rejection', async () => {
    const wallet = await api().get(`${V}/wallet`).set(auth(electrician.token));
    const available = wallet.body.available_minor;
    expect(available).toBeGreaterThan(0);
    const tooMuch = await api().post(`${V}/wallet/payouts`).set(auth(electrician.token)).send({ amountMinor: available + 100 });
    expect(tooMuch.status).toBe(400);

    const po = await api().post(`${V}/wallet/payouts`).set(auth(electrician.token)).send({ amountMinor: 10000 });
    expect(po.status, JSON.stringify(po.body)).toBe(201);
    expect((await api().get(`${V}/wallet`).set(auth(electrician.token))).body.available_minor).toBe(available - 10000);
    const ok = await api().post(`${V}/wallet/payouts/${po.body.id}/approve`).set(auth(adminToken));
    expect(ok.body.status).toBe('paid');

    const po2 = await api().post(`${V}/wallet/payouts`).set(auth(electrician.token)).send({ amountMinor: 5000 });
    await api().post(`${V}/wallet/payouts/${po2.body.id}/reject`).set(auth(adminToken)).send({ reason: 'Name mismatch on wallet' });
    expect((await api().get(`${V}/wallet`).set(auth(electrician.token))).body.available_minor).toBe(available - 10000);
  });
});

describe('disputes', () => {
  it('refunds a settled job by reversing the ledger', async () => {
    const booking = await book(faultRepair, central, 'orange_money');
    const p = await pay(booking.id, 'orange_money', '076111111', 'dispute-1');
    await api().post(`${V}/payments/${p.id}/simulate`).set(auth(customer.token)).send({});
    await api().post(`${V}/bookings/${booking.id}/accept`).set(auth(electrician.token));
    await runJob(electrician.token, booking.id);
    const d = await api().post(`${V}/bookings/${booking.id}/dispute`).set(auth(customer.token)).send({ reason: 'Lights still flicker' });
    expect(d.body.status).toBe('disputed');
    const r = await api().post(`${V}/bookings/${booking.id}/resolve`).set(auth(adminToken)).send({ resolution: 'refund', note: 'Work not done properly' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('cancelled');
    const net = await query(`SELECT account_type, sum(amount_minor)::int AS n FROM ledger_entries WHERE booking_id = $1 GROUP BY 1 ORDER BY 1`, [booking.id]);
    expect(net).toEqual([
      { account_type: 'customer', n: 25000 },
      { account_type: 'platform_revenue', n: 0 },
      { account_type: 'platform_tax', n: 0 },
      { account_type: 'provider', n: 0 },
    ]);
  });
});

describe('USSD channel', () => {
  const session = 'ussd-test-1';
  const phone = '+23276777123';
  const ussd = (text: string) => api().post(`${V}/ussd`).type('form').send({ sessionId: session, serviceCode: '*123#', phoneNumber: phone, text });

  it('books a job end to end from a feature phone', async () => {
    expect((await ussd('')).text).toMatch(/^CON Welcome to FixAm/);
    expect((await ussd('1')).text).toMatch(/^CON Choose a trade:\n1\. Electrical/);
    expect((await ussd('1*1')).text).toMatch(/Choose a job/);
    const areas = (await ussd('1*1*1')).text;
    expect(areas).toMatch(/Your area/);
    const centralIdx = areas.split('\n').find((l) => l.endsWith('Central'))!.split('.')[0];
    expect((await ussd(`1*1*1*${centralIdx}`)).text).toMatch(/When\?/);
    const price = (await ussd(`1*1*1*${centralIdx}*2`)).text;
    expect(price).toMatch(/Price: Le/);
    expect((await ussd(`1*1*1*${centralIdx}*2*1`)).text).toMatch(/landmark/);
    const end = (await ussd(`1*1*1*${centralIdx}*2*1*Near Victoria Park market`)).text;
    expect(end).toMatch(/^END Booked FX-[A-Z0-9]{6}/);
    const b = await one(`SELECT b.channel, b.address, b.payment_method FROM bookings b JOIN users u ON u.id = b.customer_id WHERE u.phone = $1`, [phone]);
    expect(b).toMatchObject({ channel: 'ussd', payment_method: 'cash' });
    expect(b.address.landmark).toBe('Near Victoria Park market');
    expect((await ussd('2')).text).toMatch(/^END FX-.*\nStatus: pending/);
  });

  it('rejects callers without the aggregator secret when one is configured', async () => {
    process.env.USSD_SHARED_SECRET = 'agg-secret';
    try {
      expect((await ussd('')).status).toBe(401);
      const ok = await api().post(`${V}/ussd`).set('x-ussd-secret', 'agg-secret').type('form').send({ sessionId: 's2', phoneNumber: phone, text: '' });
      expect(ok.text).toMatch(/^CON /);
    } finally {
      delete process.env.USSD_SHARED_SECRET;
    }
  });

  it('switches to Krio and checks badge codes', async () => {
    expect((await ussd('4')).text).toMatch(/Kushe/);
    const code = (await one(`SELECT verification_code FROM provider_badges WHERE status = 'approved' AND badge_code = 'NATIONAL_ID' LIMIT 1`)).verification_code;
    expect((await ussd(`3*${code}`)).text).toMatch(/^END VALID: ID verified/);
    expect((await ussd('3*FXB-BADBAD')).text).toMatch(/NOT valid/);
  });
});

describe('admin dashboard', () => {
  it('reports totals that agree with the ledger', async () => {
    const r = await api().get(`${V}/admin/dashboard`).set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.totals.completed).toBeGreaterThan(0);
    expect(r.body.totals.ussd_bookings).toBeGreaterThanOrEqual(1);
    const ledgerCommission = await one(`SELECT COALESCE(sum(amount_minor),0)::int AS n FROM ledger_entries WHERE account_type = 'platform_revenue' AND entry_type IN ('commission','settlement_reversal')`);
    expect(Number(r.body.totals.commission_minor)).toBe(ledgerCommission.n);
  });

  it('validates settings types', async () => {
    const bad = await api().put(`${V}/admin/settings`).set(auth(adminToken)).send({ 'pricing.max_multiplier': 'lots' });
    expect(bad.status).toBe(400);
    const ok = await api().put(`${V}/admin/settings`).set(auth(adminToken)).send({ 'pricing.max_multiplier': 2 });
    expect(ok.body['pricing.max_multiplier']).toBe(2);
    await setSetting('pricing.max_multiplier', 1.75);
  });
});
