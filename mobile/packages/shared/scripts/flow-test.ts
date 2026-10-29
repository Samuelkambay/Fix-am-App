/**
 * Headless happy-path test of the shared API client against the live FixAm API.
 *
 *   cd mobile && npm run flow-test           (or: npx tsx packages/shared/scripts/flow-test.ts)
 *   FIXAM_API_URL=http://localhost:4000/api/v1 npx tsx scripts/flow-test.ts
 *
 * Exercises the same code the apps use: ApiClient (bearer + refresh), createFixamApi endpoints,
 * PaymentSession (Idempotency-Key reuse, 3 s polling, sandbox simulate), phone and money helpers.
 * Exits non-zero on the first failure.
 *
 * Note: the API allows 3 OTP codes per phone per 10 minutes, so run this at most 3 times in 10 minutes.
 */
import {
  ApiClient, ApiError, createFixamApi, detectOperator, formatLe, MemoryKV, MemoryTokenStore, normalizeSlPhone,
  PaymentSession, peakLabels, suggestedWallet, summariseCurve, freetownDate, formatTime, type FixamApi, type Booking,
} from '../src/index';

const BASE = process.env.FIXAM_API_URL ?? 'http://localhost:4000/api/v1';
const CUSTOMER = '076111111';
const PROVIDER = '077222222';
const ZONE_NAME = 'Freetown - Central';

let stepNo = 0;
const t0 = Date.now();
let pending: string[] = [];

/** Detail lines are buffered and printed under their step's result line. */
function log(msg: string) {
  pending.push(`      ${msg}`);
}

async function step<T>(title: string, fn: () => Promise<T>): Promise<T> {
  stepNo++;
  const started = Date.now();
  const label = `[${String(stepNo).padStart(2, '0')}] ${title}`;
  pending = [];
  try {
    const out = await fn();
    console.log(`${label} … ok (${Date.now() - started} ms)`);
    return out;
  } catch (e) {
    console.log(`${label} … FAILED`);
    throw e;
  } finally {
    for (const l of pending) console.log(l);
    pending = [];
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function makeApi(): FixamApi {
  return createFixamApi(new ApiClient({ baseUrl: BASE, tokenStore: new MemoryTokenStore(), timeoutMs: 20_000 }));
}

/** OTP login. The API allows 3 codes per number per 10 minutes and the demo numbers are shared with other
 *  testers, so a 429 waits a minute and tries again (up to ~10 minutes). */
async function otpLogin(api: FixamApi, phone: string) {
  let req;
  for (let attempt = 0; ; attempt++) {
    try {
      req = await api.auth.requestOtp(phone);
      break;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 429) || attempt >= 10) throw e;
      console.log(`      ${phone}: OTP rate limited (shared demo number); waiting 60 s and retrying`);
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
  assert(req.sent, 'OTP sent');
  assert(req.devCode && /^\d{6}$/.test(req.devCode), 'devCode returned outside production');
  const res = await api.auth.verifyOtp({ phone, code: req.devCode });
  assert(res.accessToken && res.refreshToken, 'tokens issued');
  assert(res.user.phone === normalizeSlPhone(phone), `phone normalised to ${res.user.phone}`);
  return res.user;
}

async function main() {
  console.log(`FixAm flow test against ${BASE}\n`);
  const customer = makeApi();
  const provider = makeApi();

  await step('API is up', async () => {
    const health = await customer.client.get<{ ok: boolean }>('/health', { auth: false });
    assert(health.ok, 'health ok');
  });

  // ── 1. Customer: login, quote, book ───────────────────────────────────────
  const me = await step(`Customer ${CUSTOMER} logs in by OTP`, async () => {
    const u = await otpLogin(customer, CUSTOMER);
    assert(u.role === 'customer', `role is customer (got ${u.role})`);
    log(`${u.name ?? '(no name)'} ${u.phone}`);
    return u;
  });

  await step('Shared phone helpers agree with the server on the SIM network', async () => {
    const op = detectOperator(me.phone);
    const methods = await customer.payments.methods(CUSTOMER);
    assert(methods.operator === op, `operator ${op} == server ${methods.operator}`);
    assert(methods.suggested === suggestedWallet(CUSTOMER), `suggested wallet ${methods.suggested}`);
    assert(methods.suggested === 'orange_money', '076 is Orange, so Orange Money is suggested');
    log(`operator=${op}, suggested=${methods.suggested}, methods=${methods.methods.map((m) => m.code).join(',')}`);
  });

  const zone = await step(`Find zone "${ZONE_NAME}"`, async () => {
    const zones = await customer.zones.list();
    const z = zones.find((x) => x.name === ZONE_NAME);
    assert(z, 'zone exists');
    const resolved = await customer.zones.resolve(z.center_lat, z.center_lng);
    assert(resolved.id === z.id, 'GPS resolve of the zone centre returns the zone');
    return z;
  });

  const service = await step('Find an electrical service offered in that zone', async () => {
    const cats = await customer.catalog.categories();
    const elec = cats.find((c) => c.slug === 'electrical');
    assert(elec, 'electrical category');
    const services = await customer.catalog.services({ categoryId: elec.id, zoneId: zone.id });
    const s = services.find((x) => x.name.startsWith('Electrical fault')) ?? services[0];
    assert(s, 'an electrical service in the zone');
    log(`${s.name} (${formatLe(s.base_price_minor)} ${s.price_unit})`);
    return s;
  });

  const scheduledAt = await step('Day curve for tomorrow: pick the cheapest bookable hour', async () => {
    const date = freetownDate(1);
    const curve = await customer.pricing.dayCurve({ serviceId: service.id, zoneId: zone.id, date });
    assert(curve.hours.length === 17, '06:00-22:00 = 17 hours');
    const summary = summariseCurve(curve.hours);
    assert(summary.cheapest, 'a cheapest hour');
    const strip = summary.hours.map((h) => `${String(h.hour).padStart(2, '0')}:${formatLe(h.totalMinor).slice(3)}${h.isCheapest ? '*' : ''}`).join(' ');
    log(strip);
    log(`cheapest ${formatTime(summary.cheapest.at)} ${formatLe(summary.cheapest.totalMinor)}; save up to ${formatLe(summary.maxSavingMinor)} vs the dearest hour`);
    // Book at 10:00 if it is a cheapest hour (a predictable, off-peak time), else the first cheapest hour.
    const ten = summary.hours.find((h) => h.hour === 10 && h.isCheapest);
    return (ten ?? summary.cheapest).at;
  });

  const quote = await step('Quote the job (locks the price for 15 minutes)', async () => {
    const q = await customer.pricing.quote({ serviceId: service.id, zoneId: zone.id, scheduledAt });
    assert(q.total_minor === q.subtotal_minor + q.surcharge_minor, 'total = subtotal + surcharge');
    assert(q.customer_id === me.id, 'quote tied to the logged-in customer');
    const minsLeft = Math.round((new Date(q.expires_at).getTime() - Date.now()) / 60000);
    assert(minsLeft >= 14 && minsLeft <= 15, `price lock ~15 min (got ${minsLeft})`);
    log(`${q.breakdown.lines.map((l) => `${l.label} ${formatLe(l.amountMinor)}`).join(' | ')} = ${formatLe(q.total_minor)}`);
    log(`rules: ${peakLabels(q.breakdown).join(', ') || 'none (off-peak)'}; expires ${q.expires_at}`);
    return q;
  });

  const booking = await step('Book with orange_money (area + landmark address)', async () => {
    const b = await customer.bookings.create({
      quoteId: quote.id,
      paymentMethod: 'orange_money',
      address: { area: 'Kissy Road', landmark: 'Opposite the Total filling station, blue gate (flow test)', contactPhone: CUSTOMER },
      notes: 'Flow test: lights trip when the kettle is on',
    });
    assert(b.status === 'pending', 'pending');
    assert(b.payment_status === 'unpaid', 'unpaid');
    assert(b.total_minor === quote.total_minor, 'booking total equals the locked quote');
    assert(b.address.landmark.includes('Total'), 'landmark stored');
    log(`${b.code} ${b.service_name} ${formatLe(b.total_minor)} at ${b.scheduled_at}`);
    return b;
  });

  // ── 2. Customer pays with mobile money ────────────────────────────────────
  await step('Pay: create payment, re-send with the same Idempotency-Key, simulate, poll to success', async () => {
    const kv = new MemoryKV();
    let simulated = false;
    let replayChecked = false;
    const phases: string[] = [];
    const session = new PaymentSession(customer, {
      pollIntervalMs: 3000,
      maxWaitMs: 90_000,
      store: kv,
      storeKey: `pay:booking:${booking.id}`,
      onChange: (s) => {
        if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
      },
    });
    const body = { purpose: 'booking' as const, bookingId: booking.id, gateway: 'orange_money' as const, msisdn: CUSTOMER };

    // Run the session; when it starts waiting for the PIN, check idempotency then play the operator.
    const watcher = (async () => {
      while (!simulated) {
        await new Promise((r) => setTimeout(r, 200));
        const s = session.snapshot;
        if (s.phase === 'waiting' && s.payment && s.idempotencyKey) {
          log(`customer_action: "${s.payment.customer_action?.message}"`);
          const replay = await customer.payments.create(body, s.idempotencyKey);
          assert(replay.id === s.payment.id, 'same Idempotency-Key returns the same payment (no double charge)');
          replayChecked = true;
          try {
            await customer.payments.create(body, 'fx-a-different-key-123');
            throw new Error('expected 409 payment_in_progress for a second key');
          } catch (e) {
            assert(e instanceof ApiError && e.code === 'payment_in_progress', `second key rejected with payment_in_progress (got ${(e as Error).message})`);
          }
          await session.simulate('succeeded');
          simulated = true;
          log(`simulated approval for payment ${s.payment.id}`);
        }
        if (['error', 'failed', 'expired'].includes(s.phase)) return;
      }
    })();

    const result = await session.start(body);
    await watcher;
    log(`phases: ${phases.join(' -> ')}`);
    assert(replayChecked, 'idempotency replay checked');
    assert(result.phase === 'succeeded', `payment succeeded (phase ${result.phase}, ${result.error?.message ?? result.payment?.failure_reason ?? ''})`);
    assert(result.payment?.status === 'succeeded', 'payment status succeeded');
    assert(result.payment.amount_minor === booking.total_minor, 'server charged the booking total');
    assert((await kv.getItem(`pay:booking:${booking.id}`)) === null, 'saved attempt cleared after success');
    const b = await customer.bookings.get(booking.id);
    assert(b.payment_status === 'paid', `booking paid (got ${b.payment_status})`);
  });

  // ── 3. Provider accepts and does the job ──────────────────────────────────
  await step(`Provider ${PROVIDER} logs in by OTP`, async () => {
    const u = await otpLogin(provider, PROVIDER);
    assert(u.role === 'provider' && u.provider_id, 'provider account');
    const dash = await provider.providers.me();
    log(`${dash.business_name}: status=${dash.status}, can_accept_jobs=${dash.can_accept_jobs}, blockers=[${dash.accept_blockers.join(', ')}], balance ${formatLe(dash.balance_minor)}`);
  });

  // The demo provider is shared with other testers; their cash jobs can push it over the cash-commission limit.
  // A blocked provider clears it the way the Pro app does: a cash_settlement mobile money payment.
  await step('Provider is free to accept jobs (pays owed cash commission first if blocked)', async () => {
    let dash = await provider.providers.me();
    if (dash.accept_blockers.includes('cash_commission_limit_exceeded')) {
      const owed = dash.commission_owed_minor;
      const msisdn = dash.payout_msisdn ?? PROVIDER;
      const gateway = suggestedWallet(msisdn);
      log(`blocked: owes ${formatLe(owed)} (limit ${formatLe(dash.cash_commission_limit_minor)}); paying with ${gateway}`);
      const session = new PaymentSession(provider, { pollIntervalMs: 3000, maxWaitMs: 90_000 });
      const run = session.start({ purpose: 'cash_settlement', amountMinor: owed, gateway: gateway as 'afrimoney', msisdn });
      while (session.snapshot.phase !== 'waiting' && !['error', 'failed', 'succeeded'].includes(session.snapshot.phase)) await new Promise((r) => setTimeout(r, 200));
      if (session.snapshot.phase === 'waiting') await session.simulate('succeeded');
      const res = await run;
      assert(res.phase === 'succeeded', `cash_settlement succeeded (${res.phase} ${res.error?.message ?? ''})`);
      dash = await provider.providers.me();
      log(`paid ${formatLe(res.payment?.amount_minor)}; balance now ${formatLe(dash.balance_minor)}`);
    }
    assert(dash.can_accept_jobs, `provider can accept jobs (blockers: ${dash.accept_blockers.join(', ')})`);
  });

  await step('Provider sees the job in requests (no customer phone yet) and accepts it', async () => {
    const requests = await provider.bookings.list({ scope: 'requests' });
    const row = requests.find((r) => r.id === booking.id);
    assert(row, `booking ${booking.code} is in the provider's requests (${requests.length} open)`);
    log(`request: ${row.service_name} in ${row.area}, landmark "${row.landmark}", ${formatLe(row.total_minor)}${row.surcharge_minor > 0 ? ' (peak)' : ''}${row.is_emergency ? ' URGENT' : ''}`);
    const preview = await provider.bookings.get(booking.id);
    assert(preview.customer_phone === null, 'customer phone hidden before accepting');
    const accepted = await provider.bookings.accept(booking.id);
    assert(accepted.status === 'accepted', 'accepted');
    assert(accepted.customer_phone === me.phone, 'customer phone visible after accepting');
  });

  await step('Provider marks en route', async () => {
    const b = await provider.bookings.enRoute(booking.id);
    assert(b.status === 'en_route', 'en_route');
  });

  const startCode = await step("Customer's booking detail shows the start code", async () => {
    const b = await customer.bookings.get(booking.id);
    assert(b.status === 'en_route', 'customer sees en_route');
    assert(b.start_code && /^\d{4}$/.test(b.start_code), 'start code visible to the customer');
    assert(!b.completion_code, 'no completion code before work starts');
    assert(b.provider_name === 'Bright Spark Electrical', `handyman details shown (${b.provider_name})`);
    log(`start code ${b.start_code}; fixer ${b.provider_name} ${b.provider_phone}`);
    return b.start_code;
  });

  await step('Provider starts the job (a wrong code is refused first)', async () => {
    const wrong = startCode === '0000' ? '1111' : '0000';
    try {
      await provider.bookings.start(booking.id, wrong);
      throw new Error('wrong code accepted');
    } catch (e) {
      assert(e instanceof ApiError && e.code === 'wrong_code', `wrong code -> wrong_code (got ${(e as Error).message})`);
    }
    const b = await provider.bookings.start(booking.id, startCode);
    assert(b.status === 'in_progress', 'in_progress');
  });

  const completionCode = await step("Customer's booking detail shows the completion code", async () => {
    const b = await customer.bookings.get(booking.id);
    assert(b.completion_code && /^\d{4}$/.test(b.completion_code), 'completion code visible once in progress');
    log(`completion code ${b.completion_code}`);
    return b.completion_code;
  });

  const done = await step('Provider completes the job with the completion code', async () => {
    const b: Booking = await provider.bookings.complete(booking.id, completionCode);
    assert(b.status === 'completed', 'completed');
    assert(typeof b.provider_earning_minor === 'number' && b.provider_earning_minor > 0, 'earning settled');
    log(`total ${formatLe(b.total_minor)}: commission ${formatLe(b.commission_minor)} + GST ${formatLe(b.commission_gst_minor)}, provider keeps ${formatLe(b.provider_earning_minor)}`);
    return b;
  });

  // ── 4. Customer reviews ───────────────────────────────────────────────────
  await step('Customer rates the job 5 stars', async () => {
    const r = await customer.reviews.create({ bookingId: booking.id, rating: 5, comment: 'Fast and tidy. Tenki! (flow test)' });
    assert(r.rating === 5, 'review saved');
    const b = await customer.bookings.get(booking.id);
    assert(b.review_rating === 5, 'booking shows the rating');
    assert(!b.start_code && !b.completion_code, 'codes hidden after completion');
    const events = b.events.map((e) => e.to_status).join(' -> ');
    log(`timeline: ${events}`);
  });

  // ── 5. Provider wallet shows the earning ──────────────────────────────────
  await step('Provider wallet has a job_earning entry for this booking', async () => {
    const w = await provider.wallet.provider();
    assert(w.account === 'provider', 'provider wallet');
    const entry = w.entries.find((e) => e.entry_type === 'job_earning' && e.booking_id === booking.id);
    assert(entry, 'job_earning entry present');
    assert(entry.amount_minor === done.provider_earning_minor, 'entry equals the settled earning');
    log(`job_earning ${formatLe(entry.amount_minor)} (${entry.memo}); balance ${formatLe(w.balance_minor)}, available ${formatLe(w.available_minor)}`);
  });

  await step('Token refresh works (rotate, then call /auth/me)', async () => {
    assert(await customer.auth.refresh(), 'refresh rotated tokens');
    const u = await customer.auth.me();
    assert(u.id === me.id, 'same user after refresh');
  });

  console.log(`\nPASS: ${stepNo} steps in ${((Date.now() - t0) / 1000).toFixed(1)} s. Booking ${booking.code} went pending -> paid -> completed -> reviewed.`);
}

main().catch((e) => {
  if (e instanceof ApiError) {
    console.error(`\nFAIL: API ${e.status} ${e.code}: ${e.message}`, e.details ? JSON.stringify(e.details) : '');
  } else {
    console.error(`\nFAIL: ${(e as Error).stack ?? e}`);
  }
  process.exit(1);
});
