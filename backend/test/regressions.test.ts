// Regressions for issues found while building the admin and provider panels.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one, query } from '../src/db.js';
import { bookingCode } from '../src/modules/bookings/bookings.service.js';
import { api, auth, closePool, freshDb, ids, loginAdmin, loginOtp, offPeakSlot, V } from './helpers.js';

let admin: string;
let customer: string;
let electrician: string;
let central: string;
let faultRepair: string;
let brightSpark: string;

beforeAll(async () => {
  await freshDb();
  const i = await ids();
  central = await i.zone('Freetown - Central');
  faultRepair = await i.service('Electrical fault finding & repair');
  brightSpark = await i.provider('Bright Spark Electrical');
  admin = await loginAdmin();
  customer = (await loginOtp('076111111')).token;
  electrician = (await loginOtp('077222222')).token;
});
afterAll(closePool);

async function completedCashJob() {
  const q = await api().post(`${V}/pricing/quote`).set(auth(customer)).send({ serviceId: faultRepair, zoneId: central, scheduledAt: offPeakSlot().toISOString() });
  const b = await api().post(`${V}/bookings`).set(auth(customer)).send({ quoteId: q.body.id, paymentMethod: 'cash', address: { area: 'Tower Hill', landmark: 'Blue gate' } });
  await api().post(`${V}/bookings/${b.body.id}/accept`).set(auth(electrician));
  await api().post(`${V}/bookings/${b.body.id}/en-route`).set(auth(electrician));
  await api().post(`${V}/bookings/${b.body.id}/start`).set(auth(electrician)).send({ code: bookingCode(b.body.id, 'start') });
  await api().post(`${V}/bookings/${b.body.id}/complete`).set(auth(electrician)).send({ code: bookingCode(b.body.id, 'complete') });
  return b.body.id as string;
}

describe('ledger', () => {
  it('admin cancelling a disputed cash job reverses the commission the provider owed', async () => {
    const id = await completedCashJob();
    expect((await one(`SELECT sum(amount_minor)::int AS n FROM ledger_entries WHERE booking_id = $1 AND account_type = 'provider'`, [id])).n).toBeLessThan(0);
    await api().post(`${V}/bookings/${id}/dispute`).set(auth(customer)).send({ reason: 'Sockets still dead' });
    const r = await api().post(`${V}/bookings/${id}/cancel`).set(auth(admin)).send({ reason: 'Job not done' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const net = await query(`SELECT account_type, sum(amount_minor)::int AS n FROM ledger_entries WHERE booking_id = $1 GROUP BY 1 ORDER BY 1`, [id]);
    expect(net.every((row) => row.n === 0)).toBe(true);
  });
});

describe('badges', () => {
  it('keeps the current badge valid while its renewal is reviewed, then swaps it on approval', async () => {
    const old = await one(`SELECT id, verification_code FROM provider_badges WHERE provider_id = $1 AND badge_code = 'NATIONAL_ID' AND status = 'approved'`, [brightSpark]);
    await query(`UPDATE provider_badges SET expires_at = now() + interval '10 days' WHERE id = $1`, [old.id]);
    const apply = await api().post(`${V}/badges/apply`).set(auth(electrician)).send({
      badgeCode: 'NATIONAL_ID', documents: [{ type: 'id_document', url: '/a.jpg' }, { type: 'selfie', url: '/b.jpg' }],
    });
    expect(apply.status, JSON.stringify(apply.body)).toBe(201);
    expect((await api().get(`${V}/badges/verify/${old.verification_code}`)).body.valid).toBe(true);
    expect((await api().get(`${V}/providers/me`).set(auth(electrician))).body.accept_blockers).not.toContain('missing_badge:NATIONAL_ID');

    await api().post(`${V}/badges/applications/${apply.body.id}/review`).set(auth(admin)).send({ decision: 'approve' });
    expect((await api().get(`${V}/badges/verify/${old.verification_code}`)).body.valid).toBe(false);
    expect((await api().get(`${V}/badges/verify/${apply.body.verification_code}`)).body.valid).toBe(true);
  });
});

describe('ratings', () => {
  it('a new review updates the existing average instead of replacing it', async () => {
    const before = await one('SELECT rating_avg, rating_count FROM providers WHERE id = $1', [brightSpark]);
    const id = await completedCashJob();
    await api().post(`${V}/reviews`).set(auth(customer)).send({ bookingId: id, rating: 5 });
    const after = await one('SELECT rating_avg, rating_count FROM providers WHERE id = $1', [brightSpark]);
    expect(after.rating_count).toBe(before.rating_count + 1);
    expect(after.rating_avg).toBeCloseTo((before.rating_avg * before.rating_count + 5) / (before.rating_count + 1), 2);
  });
});

describe('admin catalog', () => {
  it('lists inactive items for admins only, and can re-parent a category', async () => {
    const z = await api().post(`${V}/zones`).set(auth(admin)).send({ name: 'Lunsar', district: 'Port Loko', city: 'Lunsar', centerLat: 8.68, centerLng: -12.53, radiusKm: 5, active: false });
    expect((await api().get(`${V}/zones`)).body.map((x: any) => x.id)).not.toContain(z.body.id);
    expect((await api().get(`${V}/zones?includeInactive=true`)).body.map((x: any) => x.id)).not.toContain(z.body.id);
    expect((await api().get(`${V}/zones?includeInactive=true`).set(auth(admin))).body.map((x: any) => x.id)).toContain(z.body.id);

    const parent = (await one(`SELECT id FROM categories WHERE slug = 'electrical'`)).id;
    const child = await api().post(`${V}/catalog/categories`).set(auth(admin)).send({ slug: 'solar-wiring', name: 'Solar wiring' });
    const moved = await api().patch(`${V}/catalog/categories/${child.body.id}`).set(auth(admin)).send({ parentId: parent });
    expect(moved.body.parent_id).toBe(parent);
    const top = await api().patch(`${V}/catalog/categories/${child.body.id}`).set(auth(admin)).send({ parentId: null });
    expect(top.body.parent_id).toBeNull();
  });

  it('accepts rule times in the HH:MM:SS form the API returns', async () => {
    const rules = await api().get(`${V}/pricing/rules`).set(auth(admin));
    const evening = rules.body.find((r: any) => r.name === 'Weekday evening peak');
    expect(evening.start_time).toBe('17:00:00');
    const r = await api().patch(`${V}/pricing/rules/${evening.id}`).set(auth(admin)).send({ startTime: evening.start_time, endTime: '21:30:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.end_time).toBe('21:30:00');
  });

  it('shows one provider’s badges and ledger to admins', async () => {
    const badges = await api().get(`${V}/admin/providers/${brightSpark}/badges`).set(auth(admin));
    expect(badges.body.length).toBeGreaterThan(0);
    const ledger = await api().get(`${V}/admin/providers/${brightSpark}/ledger`).set(auth(admin));
    expect(typeof ledger.body.balance_minor).toBe('number');
  });
});

describe('provider plans', () => {
  it('pays a subscription from earnings and reuses an abandoned attempt instead of piling up rows', async () => {
    const plan = await one(`SELECT id, subscription_fee_minor FROM commission_plans WHERE code = 'growth'`);
    // Give the provider earnings to pay from.
    await query(`INSERT INTO ledger_entries (account_type, account_id, entry_type, amount_minor, memo) VALUES ('provider', $1, 'job_earning', 100000, 'test credit')`, [brightSpark]);
    const abandoned = await api().post(`${V}/payments`).set(auth(electrician)).set('Idempotency-Key', 'sub-abandon-1').send({ purpose: 'subscription', planId: plan.id, gateway: 'afrimoney', msisdn: '077222222' });
    expect(abandoned.status).toBe(201);
    const before = (await api().get(`${V}/wallet`).set(auth(electrician))).body.balance_minor;
    const paid = await api().post(`${V}/payments`).set(auth(electrician)).set('Idempotency-Key', 'sub-wallet-1').send({ purpose: 'subscription', planId: plan.id, gateway: 'wallet' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.status).toBe('succeeded');
    expect((await api().get(`${V}/wallet`).set(auth(electrician))).body.balance_minor).toBe(before - plan.subscription_fee_minor);
    const subs = await query(`SELECT status FROM provider_subscriptions WHERE provider_id = $1 AND plan_id = $2`, [brightSpark, plan.id]);
    expect(subs).toEqual([{ status: 'active' }]);
    const customerWallet = await one(`SELECT count(*)::int AS n FROM ledger_entries WHERE account_type = 'customer' AND payment_id = $1`, [paid.body.id]);
    expect(customerWallet.n).toBe(0);
  });

  it('lets a provider switch back to pay-per-job, but not onto a subscription without paying', async () => {
    const standard = (await one(`SELECT id FROM commission_plans WHERE code = 'standard'`)).id;
    const pro = (await one(`SELECT id FROM commission_plans WHERE code = 'pro_monthly'`)).id;
    expect((await api().put(`${V}/providers/me/plan`).set(auth(electrician)).send({ planId: pro })).status).toBe(400);
    const r = await api().put(`${V}/providers/me/plan`).set(auth(electrician)).send({ planId: standard });
    expect(r.body.code).toBe('standard');
  });
});

describe('privacy and correctness fixes from the mobile build', () => {
  async function openRequest(extra: Record<string, unknown> = {}) {
    const q = await api().post(`${V}/pricing/quote`).set(auth(customer)).send({ serviceId: faultRepair, zoneId: central, scheduledAt: offPeakSlot().toISOString(), ...extra });
    const b = await api().post(`${V}/bookings`).set(auth(customer)).send({ quoteId: q.body.id, paymentMethod: 'orange_money', address: { area: 'Tower Hill', landmark: 'Blue gate', street: '12 Pademba Road' } });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    return b.body;
  }

  it('only providers who could take an open job can read it, and they never see contact details', async () => {
    const b = await openRequest();
    const plumber = (await loginOtp('076333333')).token; // plumbing only, no electrical
    expect((await api().get(`${V}/bookings/${b.id}`).set(auth(plumber))).status).toBe(404);
    const seen = await api().get(`${V}/bookings/${b.id}`).set(auth(electrician));
    expect(seen.status).toBe(200);
    expect(seen.body.customer_phone).toBeNull();
    expect(seen.body.address).toEqual({ area: 'Tower Hill', landmark: 'Blue gate' });
  });

  it('hides contact details on a direct booking until the provider accepts', async () => {
    const b = await openRequest({ providerId: brightSpark });
    const before = await api().get(`${V}/bookings/${b.id}`).set(auth(electrician));
    expect(before.body.customer_phone).toBeNull();
    expect(before.body.address.street).toBeUndefined();
    await api().post(`${V}/bookings/${b.id}/accept`).set(auth(electrician));
    const after = await api().get(`${V}/bookings/${b.id}`).set(auth(electrician));
    expect(after.body.customer_phone).toBe('+23276111111');
    expect(after.body.address.street).toBe('12 Pademba Road');
    const list = await api().get(`${V}/bookings?scope=provider`).set(auth(electrician));
    expect(list.body.find((x: any) => x.id === b.id).provider_id).toBe(brightSpark);
  });

  it('keeps the booked payment method until a different wallet actually pays', async () => {
    const b = await openRequest();
    const failed = await api().post(`${V}/payments`).set(auth(customer)).set('Idempotency-Key', 'relabel-fail-1').send({ purpose: 'booking', bookingId: b.id, gateway: 'qmoney', msisdn: '031000000' });
    expect((await one('SELECT payment_method FROM bookings WHERE id = $1', [b.id])).payment_method).toBe('orange_money');
    await api().post(`${V}/payments/${failed.body.id}/simulate`).set(auth(customer)).send({ outcome: 'failed' });
    expect((await one('SELECT payment_method FROM bookings WHERE id = $1', [b.id])).payment_method).toBe('orange_money');
    const ok = await api().post(`${V}/payments`).set(auth(customer)).set('Idempotency-Key', 'relabel-ok-1').send({ purpose: 'booking', bookingId: b.id, gateway: 'qmoney', msisdn: '031000111' });
    await api().post(`${V}/payments/${ok.body.id}/simulate`).set(auth(customer)).send({});
    expect((await one('SELECT payment_method FROM bookings WHERE id = $1', [b.id])).payment_method).toBe('qmoney');
  });

  it('day curve: cheapest is chosen among bookable hours, and urgent prices are reflected', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await api().get(`${V}/pricing/day-curve`).query({ serviceId: faultRepair, zoneId: central, date: today });
    for (const h of r.body.hours) if (h.isCheapest) expect(h.bookable).toBe(true);
    const date = offPeakSlot().toISOString().slice(0, 10);
    const normal = await api().get(`${V}/pricing/day-curve`).query({ serviceId: faultRepair, zoneId: central, date });
    const urgent = await api().get(`${V}/pricing/day-curve`).query({ serviceId: faultRepair, zoneId: central, date, isEmergency: 'true' });
    const at10 = (c: any) => c.body.hours.find((h: any) => h.hour === 10).totalMinor;
    expect(at10(urgent)).toBeGreaterThan(at10(normal));
  });

  it('refuses a payout wallet on the wrong network', async () => {
    const r = await api().patch(`${V}/providers/me`).set(auth(electrician)).send({ payoutGateway: 'orange_money' }); // 077 is Africell
    expect(r.status).toBe(400);
    expect(r.body.error.details.suggestedGateway).toBe('afrimoney');
    expect((await api().patch(`${V}/providers/me`).set(auth(electrician)).send({ payoutGateway: 'monime' })).status).toBe(200);
  });
});
