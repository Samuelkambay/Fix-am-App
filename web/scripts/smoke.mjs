#!/usr/bin/env node
// Smoke test: logs in as admin, providers and a demo customer, and calls every API endpoint the web UI uses.
// It also drives real job lifecycles (cash, mobile money, dispute), so dashboards and lists have data.
//
//   node scripts/smoke.mjs                 # against http://localhost:4000/api/v1
//   API_URL=https://host/api/v1 node scripts/smoke.mjs
//
// Sessions are cached in scripts/.smoke-tokens.json and refreshed with /auth/refresh, because the API
// allows only 3 OTP codes per phone per 10 minutes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = (process.env.API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '.smoke-tokens.json');

const PHONES = {
  admin: '076000001',
  customer: '076111111',
  bright: '077222222', // Bright Spark Electrical (Africell, Afrimoney payouts)
  plumbing: '076333333', // Salone Plumbing Works (Orange, has a serviceman)
  bocool: '030555556', // Bo Cool, pending approval
};

// ───────── tiny harness ─────────
const results = [];
const covered = new Set();
let failed = 0;

class HttpError extends Error {
  constructor(status, body) {
    super(`${status} ${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`.trim());
    this.status = status;
    this.body = body;
  }
}

async function http(method, path, { token, body, headers = {}, raw, contentType } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw) {
    payload = raw;
    h['Content-Type'] = contentType;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API}${path}`, { method, headers: h, body: payload });
  const ct = res.headers.get('content-type') ?? '';
  const data = res.status === 204 ? null : ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new HttpError(res.status, data);
  return data;
}

/** Runs one check. `route` is the endpoint template it covers, e.g. "GET /bookings/:id". */
async function step(route, label, fn, { allow = [] } = {}) {
  covered.add(route);
  const t0 = Date.now();
  try {
    const out = await fn();
    results.push({ ok: true, route, label, ms: Date.now() - t0 });
    console.log(`  ✓ ${route.padEnd(46)} ${label}`);
    return out;
  } catch (e) {
    if (e instanceof HttpError && allow.some((a) => a === e.status || a === e.body?.error?.code)) {
      results.push({ ok: true, route, label: `${label} (expected ${e.status} ${e.body?.error?.code})`, ms: Date.now() - t0 });
      console.log(`  ✓ ${route.padEnd(46)} ${label} → expected ${e.status} ${e.body?.error?.code}`);
      return undefined;
    }
    failed++;
    results.push({ ok: false, route, label, error: e.message });
    console.log(`  ✗ ${route.padEnd(46)} ${label} → ${e.message}`);
    return undefined;
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (p) => `smoke-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const le = (m) => `Le ${(m / 100).toLocaleString('en-US')}`;

// ───────── sessions ─────────
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const saveCache = () => writeFileSync(CACHE, JSON.stringify(cache, null, 2));

async function otpSession(name) {
  const phone = PHONES[name];
  const c = cache[name];
  if (c?.refreshToken) {
    try {
      const t = await http('POST', '/auth/refresh', { body: { refreshToken: c.refreshToken } });
      covered.add('POST /auth/refresh');
      cache[name] = { ...c, ...t };
      saveCache();
      return cache[name];
    } catch {
      /* fall through to OTP */
    }
  }
  const req = await step('POST /auth/otp/request', `OTP for ${name}`, () => http('POST', '/auth/otp/request', { body: { phone: phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') } }));
  if (!req?.devCode) throw new Error(`No devCode for ${name} (rate limited? wait 10 minutes)`);
  const r = await step('POST /auth/otp/verify', `verify ${name}`, () => http('POST', '/auth/otp/verify', { body: { phone, code: req.devCode } }));
  cache[name] = { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
  saveCache();
  return cache[name];
}

// ───────── main ─────────
async function main() {
  console.log(`FixAm web smoke test against ${API}\n`);
  await step('GET /health', 'API is up', () => http('GET', '/health'));

  console.log('\nAuth');
  const admin = await step('POST /auth/login', 'admin password login (local format 076 000 001)', () =>
    http('POST', '/auth/login', { body: { phone: '076 000 001', password: 'Admin@123' } }),
  );
  if (!admin) throw new Error('Admin login failed; cannot continue');
  cache.admin = { accessToken: admin.accessToken, refreshToken: admin.refreshToken, user: admin.user };
  saveCache();
  const A = admin.accessToken;
  await step('POST /auth/login', 'wrong password is 401 unauthorized', () => http('POST', '/auth/login', { body: { phone: PHONES.admin, password: 'nope' } }), { allow: [401] });
  const rotated = await step('POST /auth/refresh', 'rotate admin refresh token', () => http('POST', '/auth/refresh', { body: { refreshToken: admin.refreshToken } }));
  if (rotated) {
    cache.admin = { ...cache.admin, ...rotated };
    saveCache();
    await step('POST /auth/refresh', 'old refresh token is rejected after rotation', () => http('POST', '/auth/refresh', { body: { refreshToken: admin.refreshToken } }), { allow: [401] });
  }
  await step('GET /auth/me', 'admin profile', async () => {
    const me = await http('GET', '/auth/me', { token: A });
    assert(me.role === 'admin', 'role admin');
  });

  const bright = await otpSession('bright');
  const plumbing = await otpSession('plumbing');
  const bocool = await otpSession('bocool');
  const customer = await otpSession('customer');
  const B = bright.accessToken;
  const P = plumbing.accessToken;
  const C = customer.accessToken;
  for (const [n, s] of Object.entries({ bright, plumbing, bocool })) assert(s.user?.role === 'provider' || n, 'provider');

  console.log('\nReference data');
  const zones = await step('GET /zones', 'list zones', () => http('GET', '/zones'));
  const cats = await step('GET /catalog/categories', 'category tree', () => http('GET', '/catalog/categories'));
  const services = await step('GET /catalog/services', 'all services', () => http('GET', '/catalog/services'));
  await step('GET /catalog/services', 'filter by category + search', () => http('GET', `/catalog/services?categoryId=${cats[0].id}&q=a`));
  const defs = await step('GET /badges/definitions', 'badge definitions', () => http('GET', '/badges/definitions'));
  await step('GET /payments/methods', 'detect Africell → afrimoney', async () => {
    const m = await http('GET', '/payments/methods?msisdn=077222222');
    assert(m.suggested === 'afrimoney', `suggested ${m.suggested}`);
  });
  const zone = (n) => zones.find((z) => z.name === n);
  const svc = (n) => services.find((s) => s.name.toLowerCase().includes(n));
  const central = zone('Freetown - Central');
  const westEnd = zone('Freetown - West End');

  // ───────── Provider: Bright Spark ─────────
  console.log('\nProvider panel (Bright Spark Electrical)');
  let meB = await step('GET /providers/me', 'dashboard payload', () => http('GET', '/providers/me', { token: B }));
  // A previous run leaves Bright Spark owing commission above the limit. Settle it first so it can accept jobs.
  if (meB?.commission_owed_minor > 0) await payCashSettlement(B, meB.commission_owed_minor, '077222222', 'settle leftover from previous run');
  await step('PATCH /providers/me', 'go online', () => http('PATCH', '/providers/me', { token: B, body: { isAvailable: true } }));
  meB = await http('GET', '/providers/me', { token: B });
  await step('PUT /providers/me/zones', 'save same zones', () => http('PUT', '/providers/me/zones', { token: B, body: { zoneIds: meB.zones.map((z) => z.id) } }));
  await step('PUT /providers/me/services', 'save same services + overrides', () =>
    http('PUT', '/providers/me/services', { token: B, body: { services: meB.services.map((s) => ({ serviceId: s.id, priceOverrideMinor: s.price_override_minor })) } }),
  );
  await step('GET /providers/me/commission-preview', 'what will I earn on Le 500', async () => {
    const r = await http('GET', `/providers/me/commission-preview?serviceId=${meB.services[0].id}&subtotalMinor=50000&surchargeMinor=10000`, { token: B });
    assert(r.providerEarningMinor > 0 && r.providerEarningMinor < 60000, 'earning in range');
  });
  await step('GET /providers/me/subscriptions', 'subscription history', () => http('GET', '/providers/me/subscriptions', { token: B }));
  await step('GET /badges/mine', 'own badges', () => http('GET', '/badges/mine', { token: B }));
  await step('GET /commission/plans', 'public plans', () => http('GET', '/commission/plans'));
  await step('GET /wallet', 'provider wallet', async () => {
    const w = await http('GET', '/wallet', { token: B });
    assert('available_minor' in w && 'payout_min_minor' in w, 'provider wallet shape');
  });

  // Job 1: mobile money (customer pays by Orange Money), Bright Spark accepts and completes → earning credited.
  console.log('\nJob lifecycle: mobile money');
  const fault = svc('fault finding');
  const job1 = await createBooking(C, fault.id, central.id, 'orange_money', { area: 'Kissy Road', landmark: 'Opposite the Total filling station, green gate', street: '14 Kissy Road' }, 'Lights trip when the iron is on');
  await step('GET /bookings', 'requests scope shows the new job', async () => {
    const rows = await http('GET', '/bookings?scope=requests', { token: B });
    assert(rows.some((r) => r.id === job1.id), 'job visible in requests');
  });
  await step('GET /bookings/:id', 'open request hides customer phone', async () => {
    const b = await http('GET', `/bookings/${job1.id}`, { token: B });
    assert(b.customer_phone === null && b.address.landmark, 'masked');
  });
  await step('POST /bookings/:id/accept', 'accept job', () => http('POST', `/bookings/${job1.id}/accept`, { token: B }));
  await step('POST /bookings/:id/accept', 'second accept → already_taken', () => http('POST', `/bookings/${job1.id}/accept`, { token: P }), { allow: ['already_taken', 403] });
  await customerPays(C, job1.id);
  await step('POST /bookings/:id/en-route', 'mark en route', () => http('POST', `/bookings/${job1.id}/en-route`, { token: B }));
  await step('POST /bookings/:id/start', 'wrong start code rejected', () => http('POST', `/bookings/${job1.id}/start`, { token: B, body: { code: '0000' } }), { allow: ['wrong_code'] });
  await startAndComplete(B, C, job1.id);
  await step('GET /bookings', 'provider scope + status filter', async () => {
    const rows = await http('GET', '/bookings?scope=provider&status=completed', { token: B });
    assert(rows.some((r) => r.id === job1.id), 'completed job listed');
  });
  await step('GET /bookings/:id', 'completed job has commission split', async () => {
    const b = await http('GET', `/bookings/${job1.id}`, { token: B });
    assert(b.provider_earning_minor > 0 && b.events.length >= 5, `earning ${b.provider_earning_minor}`);
  });

  console.log('\nWallet & payouts');
  let wB = await http('GET', '/wallet', { token: B });
  const p1 = await step('POST /wallet/payouts', `withdraw Le 100 (available ${le(wB.available_minor)})`, () => http('POST', '/wallet/payouts', { token: B, body: { amountMinor: 10000 } }));
  const p2 = await step('POST /wallet/payouts', 'withdraw Le 50', () => http('POST', '/wallet/payouts', { token: B, body: { amountMinor: 5000 } }));
  await step('POST /wallet/payouts', 'below minimum is rejected', () => http('POST', '/wallet/payouts', { token: B, body: { amountMinor: 100 } }), { allow: ['below_minimum'] });
  await step('GET /wallet/payouts', 'provider payout history', () => http('GET', '/wallet/payouts', { token: B }));
  await step('GET /wallet/payouts', 'admin: requested payouts', async () => {
    const rows = await http('GET', '/wallet/payouts?status=requested', { token: A });
    if (p1) assert(rows.some((r) => r.id === p1.id), 'payout in admin queue');
  });
  if (p1) {
    const approved = await step('POST /wallet/payouts/:id/approve', 'approve (sandbox pays instantly)', () => http('POST', `/wallet/payouts/${p1.id}/approve`, { token: A }));
    await step('POST /wallet/payouts/:id/mark-paid', approved?.status === 'approved' ? 'mark paid' : 'already paid by operator API → 409', () => http('POST', `/wallet/payouts/${p1.id}/mark-paid`, { token: A, body: { externalRef: 'OM-SMOKE-123' } }), {
      allow: ['payout_not_approved'],
    });
  }
  if (p2) await step('POST /wallet/payouts/:id/reject', 'reject returns money', () => http('POST', `/wallet/payouts/${p2.id}/reject`, { token: A, body: { reason: 'Smoke test: duplicate request' } }));

  // Job 2: cash with a dispute → admin releases.
  console.log('\nJob lifecycle: cash + dispute');
  const socket = svc('socket');
  const job2 = await createBooking(C, socket.id, central.id, 'cash', { area: 'Brookfields', landmark: 'Behind the National Stadium, yellow house' }, 'Two new sockets in the parlour', 2);
  await step('POST /bookings/:id/accept', 'accept cash job', () => http('POST', `/bookings/${job2.id}/accept`, { token: B }));
  await step('POST /bookings/:id/en-route', 'en route', () => http('POST', `/bookings/${job2.id}/en-route`, { token: B }));
  await startAndComplete(B, C, job2.id);
  await step('POST /bookings/:id/dispute', '(customer) opens dispute', () => http('POST', `/bookings/${job2.id}/dispute`, { token: C, body: { reason: 'One socket stopped working the next day' } }));
  await step('POST /bookings/:id/resolve', 'admin releases to provider', () => http('POST', `/bookings/${job2.id}/resolve`, { token: A, body: { resolution: 'release', note: 'Provider fixed the socket on a revisit' } }));

  // Job 3: Salone Plumbing with serviceman assignment.
  console.log('\nJob lifecycle: serviceman (Salone Plumbing)');
  const team = await step('GET /providers/me/servicemen', 'team list', () => http('GET', '/providers/me/servicemen', { token: P }));
  const added = await step('POST /providers/me/servicemen', 'add serviceman 079 990 001', () => http('POST', '/providers/me/servicemen', { token: P, body: { name: 'Alhaji Kamara', phone: '079 990 001' } }));
  if (added) {
    await step('PATCH /providers/me/servicemen/:id', 'deactivate', () => http('PATCH', `/providers/me/servicemen/${added.id}`, { token: P, body: { active: false } }));
    await step('PATCH /providers/me/servicemen/:id', 'reactivate', () => http('PATCH', `/providers/me/servicemen/${added.id}`, { token: P, body: { active: true } }));
  }
  const ibrahim = (team ?? []).find((s) => s.active) ?? added;
  const tap = svc('tap') ?? services.find((s) => s.category_slug === 'plumbing');
  const meP = await http('GET', '/providers/me', { token: P });
  const plumbSvc = meP.services.find((s) => s.id === tap?.id) ?? meP.services[0];
  const job3 = await createBooking(C, plumbSvc.id, westEnd.id, 'cash', { area: 'Aberdeen', landmark: 'Near Lumley roundabout, blue gate with a mango tree' }, 'Kitchen tap leaking');
  await step('POST /bookings/:id/accept', 'Salone Plumbing accepts', () => http('POST', `/bookings/${job3.id}/accept`, { token: P }));
  if (ibrahim) await step('POST /bookings/:id/assign', 'assign serviceman', () => http('POST', `/bookings/${job3.id}/assign`, { token: P, body: { servicemanId: ibrahim.id } }));
  await step('POST /bookings/:id/en-route', 'en route', () => http('POST', `/bookings/${job3.id}/en-route`, { token: P }));
  await startAndComplete(P, C, job3.id);

  // Job 4: provider withdraws, job 5: admin cancels, job 6+7: open requests left for the UI.
  console.log('\nCancellations and open requests');
  const job4 = await createBooking(C, socket.id, central.id, 'cash', { area: 'Wilberforce', landmark: 'Opposite the barracks gate' }, 'Switch sparks');
  await step('POST /bookings/:id/accept', 'accept', () => http('POST', `/bookings/${job4.id}/accept`, { token: B }));
  await step('POST /bookings/:id/cancel', 'provider withdraws → back to pending', async () => {
    const b = await http('POST', `/bookings/${job4.id}/cancel`, { token: B, body: { reason: 'Van broke down' } });
    assert(b.status === 'pending', `status ${b.status}`);
  });
  await step('GET /bookings', 'admin scope=all', () => http('GET', '/bookings?scope=all&limit=20', { token: A }));
  await step('GET /bookings', 'admin scope=all&status=pending', () => http('GET', '/bookings?scope=all&status=pending', { token: A }));
  await step('GET /bookings/:id', 'admin booking detail', () => http('GET', `/bookings/${job4.id}`, { token: A }));
  await step('POST /bookings/:id/cancel', 'admin cancels', () => http('POST', `/bookings/${job4.id}/cancel`, { token: A, body: { reason: 'Customer called support to cancel' } }));
  const pipe = meP.services.find((s) => s.id !== plumbSvc.id) ?? plumbSvc;
  await createBooking(C, pipe.id, westEnd.id, 'afrimoney', { area: 'Lumley', landmark: 'Behind Lumley police station' }, 'Polytank overflow pipe', 1, true);
  await createBooking(C, fault.id, central.id, 'cash', { area: 'Fourah Bay Road', landmark: 'Next to the big mosque' }, 'No power in two rooms');

  // ───────── Admin panel ─────────
  console.log('\nAdmin: dashboard & providers');
  await step('GET /admin/dashboard', 'dashboard 30 days', async () => {
    const d = await http('GET', '/admin/dashboard?days=30', { token: A });
    assert(d.totals.bookings > 0 && d.daily.length > 0, 'has bookings');
  });
  const providers = await step('GET /admin/providers', 'all providers', () => http('GET', '/admin/providers', { token: A }));
  await step('GET /admin/providers', 'filter status + search', () => http('GET', '/admin/providers?status=active&q=Spark', { token: A }));
  const pending = (providers ?? []).find((p) => p.status === 'pending');
  if (pending) await step('POST /providers/:id/status', 'keep Bo Cool pending (no-op)', () => http('POST', `/providers/${pending.id}/status`, { token: A, body: { status: 'pending', note: 'Smoke: still waiting for ID' } }));
  const powerup = (providers ?? []).find((p) => p.business_name.startsWith('PowerUp'));
  if (powerup) {
    await step('POST /providers/:id/status', 'suspend PowerUp', () => http('POST', `/providers/${powerup.id}/status`, { token: A, body: { status: 'suspended', note: 'Smoke test' } }));
    await step('POST /providers/:id/status', 'reactivate PowerUp', () => http('POST', `/providers/${powerup.id}/status`, { token: A, body: { status: 'active' } }));
    await step('PATCH /commission/providers/:id', 'set negotiated 9% override', () => http('PATCH', `/commission/providers/${powerup.id}`, { token: A, body: { overrideBps: 900 } }));
    await step('PATCH /commission/providers/:id', 'clear override, keep plan', () =>
      http('PATCH', `/commission/providers/${powerup.id}`, { token: A, body: { planId: powerup.commission_plan_id, overrideBps: null } }),
    );
  }

  console.log('\nBadges: upload, apply, review, verify');
  // A tiny valid PNG, uploaded raw with its content type exactly like the provider Badges page does.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await step('POST /uploads', 'upload police clearance (image/png)', () => http('POST', '/uploads', { token: P, raw: png, contentType: 'image/png' }));
  await step('POST /uploads', 'unsupported type rejected', () => http('POST', '/uploads', { token: P, raw: Buffer.from('hi'), contentType: 'text/plain' }), { allow: ['invalid_upload'] });
  if (up) {
    await step('GET /uploads/:name', 'uploader can read own file', () => http('GET', up.url.replace('/api/v1', ''), { token: P }));
    await step('GET /uploads/:name', 'other provider gets 404', () => http('GET', up.url.replace('/api/v1', ''), { token: B }), { allow: [404] });
    await step('GET /uploads/:name', 'admin fetches as blob', async () => {
      const buf = await http('GET', up.url.replace('/api/v1', ''), { token: A });
      assert(Buffer.isBuffer(buf) && buf.length === png.length, 'same bytes');
    });
    await step('POST /badges/apply', 'missing documents rejected', () => http('POST', '/badges/apply', { token: P, body: { badgeCode: 'BUSINESS_REGISTERED', documents: [{ type: 'business_registration', url: up.url }] } }), { allow: ['documents_missing'] });
    const app = await step('POST /badges/apply', 'apply for Background checked', () =>
      http('POST', '/badges/apply', { token: P, body: { badgeCode: 'POLICE_CLEARANCE', documents: [{ type: 'police_clearance', url: up.url, number: 'SLP-2026-0042' }] } }),
      { allow: ['already_pending', 'already_approved'] },
    );
    // A second application to reject: Trade certified (Salone Plumbing does not hold it).
    const up2 = await http('POST', '/uploads', { token: P, raw: png, contentType: 'image/png' });
    const app2 = await step('POST /badges/apply', 'apply for Trade certified', () =>
      http('POST', '/badges/apply', { token: P, body: { badgeCode: 'TRADE_CERTIFIED', documents: [{ type: 'trade_certificate', url: up2.url, number: 'GTI/PL/2019/117' }] } }),
      { allow: ['already_pending', 'already_approved'] },
    );
    const queue = await step('GET /badges/applications', 'pending queue', () => http('GET', '/badges/applications?status=pending', { token: A }));
    for (const s of ['approved', 'rejected', 'revoked', 'expired']) await step('GET /badges/applications', `status=${s}`, () => http('GET', `/badges/applications?status=${s}`, { token: A }));
    const police = app ?? (queue ?? []).find((a) => a.badge_code === 'POLICE_CLEARANCE' && a.business_name.startsWith('Salone'));
    if (police) {
      await step('POST /badges/applications/:id/review', 'reject without note → 400', () => http('POST', `/badges/applications/${police.id}/review`, { token: A, body: { decision: 'reject' } }), { allow: ['note_required', 'not_pending'] });
      const approved = await step('POST /badges/applications/:id/review', 'approve police clearance', () => http('POST', `/badges/applications/${police.id}/review`, { token: A, body: { decision: 'approve' } }), { allow: ['not_pending'] });
      const code = approved?.verification_code ?? police.verification_code;
      await step('GET /badges/verify/:code', `public verify ${code}`, async () => {
        const v = await http('GET', `/badges/verify/${code.toLowerCase()}`);
        assert(v.valid === true && v.provider === 'Salone Plumbing Works', `valid=${v.valid} reason=${v.reason}`);
      });
      await step('POST /badges/:id/revoke', 'revoke it again (keeps reruns repeatable)', () => http('POST', `/badges/${police.id}/revoke`, { token: A, body: { note: 'Smoke test revoke: certificate number did not match' } }), { allow: [404] });
      await step('GET /badges/verify/:code', 'revoked code is invalid', async () => {
        const v = await http('GET', `/badges/verify/${code}`);
        assert(v.valid === false && v.reason === 'revoked', `reason ${v.reason}`);
      });
    }
    const biz = app2 ?? (queue ?? []).find((a) => a.badge_code === 'TRADE_CERTIFIED' && a.business_name.startsWith('Salone'));
    if (biz) await step('POST /badges/applications/:id/review', 'reject with note', () => http('POST', `/badges/applications/${biz.id}/review`, { token: A, body: { decision: 'reject', note: 'Certificate photo is blurred – please upload a clearer scan' } }), { allow: ['not_pending'] });
  }
  await step('GET /badges/verify/:code', 'unknown code', async () => {
    const v = await http('GET', '/badges/verify/FXB-ZZZZZZ');
    assert(v.valid === false && v.reason === 'unknown_code', 'unknown');
  });

  console.log('\nPeak pricing');
  await step('GET /pricing/rules', 'all rules', () => http('GET', '/pricing/rules', { token: A }));
  const rule = await step('POST /pricing/rules', 'create Sunday afternoon rule', () =>
    http('POST', '/pricing/rules', {
      token: A,
      body: { name: 'Smoke Sunday', label: 'Sunday rate', kind: 'time_window', zoneId: central.id, categoryId: null, daysOfWeek: [0], startTime: '13:00', endTime: '18:00', multiplier: 1.15, flatFeeMinor: 2000, stackable: false, priority: 5, active: true },
    }),
  );
  if (rule) {
    await step('PATCH /pricing/rules/:id', 'edit, clear zone with null', async () => {
      const r = await http('PATCH', `/pricing/rules/${rule.id}`, { token: A, body: { multiplier: 1.25, zoneId: null, startTime: '12:00' } });
      assert(r.zone_id === null && Number(r.multiplier) === 1.25, 'patched');
    });
  }
  const elec = cats.find((c) => c.slug === 'electrical');
  await step('POST /pricing/simulate', 'Friday 22:00 urgent, high demand', async () => {
    const r = await http('POST', '/pricing/simulate', {
      token: A,
      body: { unitPriceMinor: 25000, quantity: 1, zoneId: central.id, categoryIds: [elec.id], scheduledAt: nextDow(5, 22).toISOString(), isEmergency: true, demandRatio: 3 },
    });
    assert(r.appliedRules.length >= 2 && r.totalMinor > r.subtotalMinor, `${r.appliedRules.length} rules`);
    assert(r.cappedBy === 'max_multiplier', `capped ${r.cappedBy}`);
  });
  if (rule) await step('DELETE /pricing/rules/:id', 'delete smoke rule', () => http('DELETE', `/pricing/rules/${rule.id}`, { token: A }));

  console.log('\nCommission');
  const plans = await step('GET /commission/plans/all', 'all plans', () => http('GET', '/commission/plans/all', { token: A }));
  let smokePlan = (plans ?? []).find((p) => p.code === 'smoke_test');
  const planBody = {
    name: 'Smoke test plan',
    model: 'hybrid',
    defaultRateBps: 1400,
    subscriptionRateBps: 500,
    surchargeRateBps: 800,
    minCommissionMinor: 500,
    maxCommissionMinor: 500000,
    subscriptionFeeMinor: 15000,
    subscriptionPeriodDays: 30,
    tiers: [{ min_gmv_minor: 0, rate_bps: 1400 }, { min_gmv_minor: 3000000, rate_bps: 1100 }],
    active: false,
  };
  if (!smokePlan) smokePlan = await step('POST /commission/plans', 'create inactive smoke plan', () => http('POST', '/commission/plans', { token: A, body: { code: 'smoke_test', ...planBody } }));
  else covered.add('POST /commission/plans');
  if (smokePlan) {
    await step('PATCH /commission/plans/:id', 'update plan, clear max with null', async () => {
      const r = await http('PATCH', `/commission/plans/${smokePlan.id}`, { token: A, body: { ...planBody, maxCommissionMinor: null } });
      assert(r.max_commission_minor === null, 'max cleared');
    });
    await step('PUT /commission/plans/:id/category-rates', 'set Electrical 18%', async () => {
      const r = await http('PUT', `/commission/plans/${smokePlan.id}/category-rates`, { token: A, body: { rates: [{ categoryId: elec.id, rateBps: 1800 }] } });
      assert(r.category_rates.length === 1, 'one rate');
    });
    await step('POST /commission/simulate', 'category rate applies', async () => {
      const r = await http('POST', '/commission/simulate', { token: A, body: { planId: smokePlan.id, subtotalMinor: 100000, surchargeMinor: 20000, categoryId: elec.id } });
      assert(r.rateSource === 'category' && r.rateBps === 1800, r.rateSource);
    });
    await step('POST /commission/simulate', 'subscription rate while paid', async () => {
      const r = await http('POST', '/commission/simulate', { token: A, body: { planId: smokePlan.id, subtotalMinor: 100000, hasActiveSubscription: true } });
      assert(r.rateSource === 'subscription' && r.rateBps === 500, r.rateSource);
    });
  }
  if (powerup) covered.add('PATCH /commission/providers/:id');

  console.log('\nCatalog & zones (created inactive so they stay out of the apps)');
  const stamp = Date.now().toString(36);
  const cat = await step('POST /catalog/categories', 'create category', () => http('POST', '/catalog/categories', { token: A, body: { slug: `smoke-${stamp}`, name: `Smoke ${stamp}`, icon: 'wrench', sortOrder: 99 } }));
  if (cat) {
    const s = await step('POST /catalog/services', 'create service', () =>
      http('POST', '/catalog/services', { token: A, body: { categoryId: cat.id, name: `Smoke service ${stamp}`, basePriceMinor: 12500, priceUnit: 'per_unit', unitLabel: 'point', durationMinutes: 45 } }),
    );
    if (s) await step('PATCH /catalog/services/:id', 'deactivate service', () => http('PATCH', `/catalog/services/${s.id}`, { token: A, body: { basePriceMinor: 15000, active: false } }));
    await step('PATCH /catalog/categories/:id', 'deactivate category', () => http('PATCH', `/catalog/categories/${cat.id}`, { token: A, body: { name: `Smoke ${stamp} (off)`, active: false } }));
  }
  const z = await step('POST /zones', 'create zone (Lunsar)', () => http('POST', '/zones', { token: A, body: { name: `Smoke Lunsar ${stamp}`, district: 'Port Loko', city: 'Lunsar', centerLat: 8.684, centerLng: -12.535, radiusKm: 6, active: true } }));
  if (z) await step('PATCH /zones/:id', 'deactivate zone', () => http('PATCH', `/zones/${z.id}`, { token: A, body: { radiusKm: 7, active: false } }));
  await step('POST /zones', 'outside Sierra Leone rejected', () => http('POST', '/zones', { token: A, body: { name: 'Accra', district: 'X', city: 'Accra', centerLat: 5.6, centerLng: -0.18, radiusKm: 5 } }), { allow: ['validation_error'] });

  console.log('\nSettings & logs');
  const settings = await step('GET /admin/settings', 'read settings', () => http('GET', '/admin/settings', { token: A }));
  if (settings)
    await step('PUT /admin/settings', 'write back the same values', () =>
      http('PUT', '/admin/settings', { token: A, body: { 'pricing.max_multiplier': settings['pricing.max_multiplier'], 'payout.fee_minor': settings['payout.fee_minor'], 'badges.required_to_accept_jobs': settings['badges.required_to_accept_jobs'] } }),
    );
  await step('PUT /admin/settings', 'wrong type rejected', () => http('PUT', '/admin/settings', { token: A, body: { 'pricing.max_multiplier': '2' } }), { allow: ['invalid_setting'] });
  await step('GET /admin/sms-outbox', 'SMS outbox', () => http('GET', '/admin/sms-outbox?limit=20', { token: A }));
  await step('GET /admin/audit-logs', 'audit log', async () => {
    const rows = await http('GET', '/admin/audit-logs?limit=20', { token: A });
    assert(rows.length > 0, 'has entries');
  });
  await step('GET /payments', 'admin payments + status filter', () => http('GET', '/payments?status=succeeded', { token: A }));
  await step('GET /payments/admin/webhook-events', 'webhook log', async () => {
    const rows = await http('GET', '/payments/admin/webhook-events', { token: A });
    assert(rows.length > 0, 'has events');
  });
  await step('GET /admin/providers', 'non-admin is forbidden', () => http('GET', '/admin/providers', { token: B }), { allow: [403] });

  // ───────── Subscription purchase (Salone Plumbing, Growth plan) ─────────
  console.log('\nPlans: buy a subscription');
  const growth = (plans ?? []).find((p) => p.code === 'growth');
  if (growth) {
    await step('POST /payments', 'Orange Money on Africell number → wallet_network_mismatch', () =>
      http('POST', '/payments', { token: P, headers: { 'Idempotency-Key': key('mm') }, body: { purpose: 'subscription', planId: growth.id, gateway: 'orange_money', msisdn: '077 123 456' } }),
      { allow: ['wallet_network_mismatch'] },
    );
    const k = key('sub');
    const pay = await step('POST /payments', 'subscription via Orange Money', () => http('POST', '/payments', { token: P, headers: { 'Idempotency-Key': k }, body: { purpose: 'subscription', planId: growth.id, gateway: 'orange_money', msisdn: '076 333 333' } }));
    if (pay) {
      await step('POST /payments', 'same Idempotency-Key returns the same payment', async () => {
        const again = await http('POST', '/payments', { token: P, headers: { 'Idempotency-Key': k }, body: { purpose: 'subscription', planId: growth.id, gateway: 'orange_money', msisdn: '076 333 333' } });
        assert(again.id === pay.id, 'idempotent');
      });
      await step('GET /payments/:id', `poll: ${pay.customer_action?.message?.slice(0, 40)}…`, async () => {
        const p = await http('GET', `/payments/${pay.id}`, { token: P });
        assert(['pending', 'succeeded'].includes(p.status), p.status);
      });
      await step('POST /payments/:id/simulate', 'simulate approval', async () => {
        const r = await http('POST', `/payments/${pay.id}/simulate`, { token: P, body: {} });
        assert(r.payment.status === 'succeeded', r.payment.status);
      }, { allow: ['not_pending'] });
      await step('GET /providers/me', 'subscription active', async () => {
        const me = await http('GET', '/providers/me', { token: P });
        assert(me.active_subscription, 'active subscription');
      });
    }
  }
  await step('GET /payments', 'provider sees own payments', () => http('GET', '/payments', { token: P }));

  // ───────── Last: a big cash job leaves Bright Spark over the cash commission limit ─────────
  console.log('\nCash commission limit');
  const wiring = svc('house wiring');
  // The commission rate falls as 30-day GMV grows (volume tiers), so repeat until the debt passes the limit.
  for (let i = 0; i < 3; i++) {
    const big = await createBooking(C, wiring.id, central.id, 'cash', { area: 'Tengbeh Town', landmark: 'Up the hill from the Mormon church, two-storey house' }, 'Rewire whole house', 25);
    await step('POST /bookings/:id/accept', 'accept big cash job', () => http('POST', `/bookings/${big.id}/accept`, { token: B }));
    await step('POST /bookings/:id/en-route', 'en route', () => http('POST', `/bookings/${big.id}/en-route`, { token: B }));
    await startAndComplete(B, C, big.id);
    meB = await http('GET', '/providers/me', { token: B });
    if (meB.commission_owed_minor > meB.cash_commission_limit_minor + 10000) break;
  }
  await step('GET /providers/me', `owes ${le(meB.commission_owed_minor)} → blocker shown`, async () => {
    assert(meB.accept_blockers.includes('cash_commission_limit_exceeded'), meB.accept_blockers.join());
  });
  const open = (await http('GET', '/bookings?scope=requests', { token: B }))[0];
  if (open) await step('POST /bookings/:id/accept', 'blocked from accepting', () => http('POST', `/bookings/${open.id}/accept`, { token: B }), { allow: ['cannot_accept'] });
  // Pay part of it, as the UI allows; it stays over the limit so the provider overview shows the "pay now" banner.
  const partial = meB.commission_owed_minor - 50000 > meB.cash_commission_limit_minor ? 50000 : 10000;
  await payCashSettlement(B, partial, '077 222 222', `partial ${le(partial)}`);

  // Logout revokes a refresh token (use a throwaway admin session).
  const throwaway = await http('POST', '/auth/login', { body: { phone: PHONES.admin, password: 'Admin@123' } });
  await step('POST /auth/logout', 'logout revokes refresh token', async () => {
    await http('POST', '/auth/logout', { body: { refreshToken: throwaway.refreshToken } });
    await http('POST', '/auth/refresh', { body: { refreshToken: throwaway.refreshToken } }).then(
      () => assert(false, 'refresh should fail'),
      (e) => assert(e.status === 401, 'refresh 401'),
    );
  });

  // ───────── report ─────────
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed, ${failed} failed, ${covered.size} distinct endpoints covered.`);
  writeFileSync(join(HERE, 'smoke-report.json'), JSON.stringify({ api: API, at: new Date().toISOString(), passed: pass, failed, endpoints: [...covered].sort(), results }, null, 2));
  if (failed) process.exitCode = 1;

  // ───────── helpers that close over tokens ─────────
  async function createBooking(token, serviceId, zoneId, paymentMethod, address, notes, quantity = 1, isEmergency = false) {
    const scheduledAt = new Date(Date.now() + 3 * 3600_000);
    const q = await step('POST /pricing/quote', `(customer) quote ${quantity > 1 ? `×${quantity}` : ''}`, () => http('POST', '/pricing/quote', { token, body: { serviceId, zoneId, scheduledAt, quantity, isEmergency } }));
    const b = await step('POST /bookings', `(customer) book ${paymentMethod}, ${address.area}`, () => http('POST', '/bookings', { token, body: { quoteId: q.id, address, notes, paymentMethod } }));
    if (!b) throw new Error('booking failed');
    return b;
  }

  async function customerPays(token, bookingId) {
    const pay = await step('POST /payments', '(customer) pay booking by Orange Money', () => http('POST', '/payments', { token, headers: { 'Idempotency-Key': key('bk') }, body: { purpose: 'booking', bookingId, gateway: 'orange_money', msisdn: '076 111 111' } }));
    if (pay) await step('POST /payments/:id/simulate', '(customer) approve on phone', () => http('POST', `/payments/${pay.id}/simulate`, { token, body: { outcome: 'succeeded' } }));
  }

  async function startAndComplete(providerToken, customerToken, id) {
    const b = await http('GET', `/bookings/${id}`, { token: customerToken });
    await step('POST /bookings/:id/start', 'start with customer code', () => http('POST', `/bookings/${id}/start`, { token: providerToken, body: { code: b.start_code } }));
    const b2 = await http('GET', `/bookings/${id}`, { token: customerToken });
    await step('POST /bookings/:id/complete', 'complete with completion code', () => http('POST', `/bookings/${id}/complete`, { token: providerToken, body: { code: b2.completion_code } }));
  }

  async function payCashSettlement(token, amountMinor, msisdn, label) {
    const pay = await step('POST /payments', `cash_settlement ${le(amountMinor)} via Afrimoney (${label})`, () =>
      http('POST', '/payments', { token, headers: { 'Idempotency-Key': key('cs') }, body: { purpose: 'cash_settlement', amountMinor, gateway: 'afrimoney', msisdn } }),
    );
    if (!pay) return;
    for (let i = 0; i < 2; i++) {
      const p = await step('GET /payments/:id', `poll (${pay.customer_action?.type})`, () => http('GET', `/payments/${pay.id}`, { token }));
      if (p?.status !== 'pending') break;
      await sleep(300);
    }
    await step('POST /payments/:id/simulate', 'simulate approval', async () => {
      const r = await http('POST', `/payments/${pay.id}/simulate`, { token, body: {} });
      assert(r.payment.status === 'succeeded', r.payment.status);
    }, { allow: ['not_pending'] });
  }
}

/** Next given weekday (0=Sun) at hour:00 Freetown time (UTC+0). */
function nextDow(dow, hour) {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  while (d.getUTCDay() !== dow || d < new Date()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

main().catch((e) => {
  console.error('\nSmoke test aborted:', e.message);
  process.exitCode = 1;
});
