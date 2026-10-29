#!/usr/bin/env node
/**
 * Drives both web builds against the live API at a phone viewport (390x844) and saves screenshots.
 *
 *   npm run web:build            # expo export --platform web for both apps
 *   node scripts/serve-web.js apps/customer/dist 8081 &
 *   node scripts/serve-web.js apps/pro/dist 8082 &
 *   node scripts/screenshots.js  # -> mobile/screenshots/*.png
 *
 * Logs in by OTP through the real UI (reads the dev code the API returns outside production).
 * Uses OTP codes for a fresh customer number, 077222222, 076333333 (API only), 030555556 and 078444444.
 * The API allows 3 codes per number per 10 minutes; logins wait and retry when rate limited.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const CUSTOMER = process.env.CUSTOMER_URL || 'http://localhost:8081';
const PRO = process.env.PRO_URL || 'http://localhost:8082';
const API = process.env.FIXAM_API_URL || 'http://localhost:4000/api/v1';
const OUT = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 390, height: 844 };
// A fresh Orange number per run (076 2xx xxx), so the demo customer's shared OTP quota is not needed.
// Ends in neither 000 (sandbox decline) nor 999 (sandbox never approves).
const CUSTOMER_PHONE = process.env.CUSTOMER_PHONE || `0762${String(Math.floor(Math.random() * 99998) + 1).padStart(5, '0')}`.replace(/(000|999)$/, '123');
const shots = [];
const tid = (id) => `[data-testid="${id}"]`;
// Stack screens stay mounted (hidden) on web, so only match what is on screen.
const T = (page, text, opts) => page.getByText(text, opts).filter({ visible: true });
const L = (page, sel) => page.locator(sel).filter({ visible: true });

async function shot(page, name, focusSelector) {
  if (focusSelector) {
    const el = page.locator(focusSelector).filter({ visible: true }).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    await el.scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(700);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(`${name}.png`);
  console.log(`  📸 ${name}.png`);
}

async function api(method, p, token, body, headers = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function apiLogin(phone) {
  let devCode;
  for (let attempt = 0; ; attempt++) {
    try {
      ({ devCode } = await api('POST', '/auth/otp/request', null, { phone }));
      break;
    } catch (e) {
      if (!/429/.test(e.message) || attempt >= 12) throw e;
      console.log(`    ${phone} is rate limited; waiting 60 s`);
      await new Promise((r) => setTimeout(r, 60000));
    }
  }
  return (await api('POST', '/auth/otp/verify', null, { phone, code: devCode })).accessToken;
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...opts });
  const page = await ctx.newPage();
  openPages.push(page);
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('    [console]', m.text().slice(0, 200));
  });
  return page;
}

/** Phone -> dev OTP -> (name on first login) -> logged in, through the real login screen. Waits out OTP rate limits. */
async function uiLogin(page, base, phone, loginShot, name = 'Mariama Koroma') {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await L(page, tid('phone-input')).fill(phone);
  if (loginShot) await shot(page, loginShot);
  const banner = T(page, /Test code: \d{6}/);
  for (let attempt = 0; ; attempt++) {
    await L(page, tid('send-code')).click();
    const r = await Promise.race([
      banner.waitFor({ timeout: 15000 }).then(() => 'ok'),
      T(page, 'Too many codes requested').waitFor({ timeout: 15000 }).then(() => 'limited'),
    ]);
    if (r === 'ok') break;
    if (attempt >= 12) throw new Error(`OTP still rate limited for ${phone}`);
    console.log(`    ${phone} is rate limited (3 codes / 10 min, shared with other testers); waiting 60 s`);
    await page.waitForTimeout(60000);
  }
  const code = /(\d{6})/.exec(await banner.innerText())[1];
  await L(page, tid('otp-input')).fill(code);
  if (loginShot) await shot(page, loginShot.replace('login', 'otp'));
  await L(page, tid('verify-code')).click();
  const named = await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).then(() => false),
    T(page, 'What is your name?').waitFor({ timeout: 20000 }).then(() => true),
  ]);
  if (named) {
    await page.getByLabel('Full name').filter({ visible: true }).fill(name);
    if (loginShot) await shot(page, loginShot.replace('login', 'name'));
    await T(page, 'Save and start').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  }
  await page.waitForLoadState('networkidle');
}

async function tokenOf(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('fixam.tokens') || 'null')?.accessToken);
}

const openPages = [];
(async () => {
  const browser = await chromium.launch();

  // ───────── Customer: book an evening electrical job and pay with Orange Money ─────────
  console.log('Customer app');
  const c = await newPage(browser, { permissions: ['geolocation'], geolocation: { latitude: 8.484, longitude: -13.234 } });
  await uiLogin(c, CUSTOMER, CUSTOMER_PHONE, 'customer-01-login');
  console.log(`  customer ${CUSTOMER_PHONE}`);
  await T(c, 'Freetown - Central').first().waitFor({ timeout: 20000 });
  await L(c, tid('cat-electrical')).waitFor();
  await shot(c, 'customer-02-home-categories');

  await L(c, tid('cat-electrical')).click();
  await T(c, 'Electrical fault finding & repair').first().click();
  await T(c, 'Price by hour').waitFor();
  // Pick a provider first (changing the provider re-prices, so quote afterwards).
  await L(c, tid('choose-provider')).click();
  await T(c, 'Bright Spark Electrical').first().waitFor();
  await shot(c, 'customer-04-providers-with-badges');
  // Book "any verified fixer": the request is broadcast to every matching provider, Bright Spark included.
  await T(c, 'Any verified fixer').first().click();
  await T(c, 'Price by hour').waitFor();
  await L(c, tid('hour-21')).waitFor();
  const evening = (await L(c, tid('hour-19')).count()) ? 'hour-19' : 'hour-21';
  await L(c, tid(evening)).click();
  await shot(c, 'customer-03-service-price-strip', tid('save-banner'));
  await L(c, tid('see-price')).click();
  await shot(c, 'customer-06-quote-peak-breakdown', tid('price-lock'));

  await L(c, tid('continue-address')).click();
  await L(c, tid('area-input')).fill('Kissy Road');
  await L(c, tid('landmark-input')).fill('Behind the Total filling station, blue gate');
  await shot(c, 'customer-07-address-landmark');
  await L(c, tid('address-next')).click();
  await T(c, 'Best for your SIM').waitFor();
  await shot(c, 'customer-08-payment-choice');
  await L(c, tid('payment-next')).click();
  await L(c, tid('book-now')).click();
  await T(c, 'Check your phone', { exact: true }).waitFor({ timeout: 20000 });
  await shot(c, 'customer-09-payment-waiting');
  await L(c, tid('simulate-approve')).click();
  await T(c, 'Payment received', { exact: true }).waitFor({ timeout: 20000 });
  await shot(c, 'customer-10-payment-succeeded');
  await L(c, tid('after-pay')).click();
  await c.waitForURL(/\/booking\//);
  const bookingId = c.url().split('/booking/')[1].split(/[?#]/)[0];
  const customerToken = await tokenOf(c);
  const booking = await api('GET', `/bookings/${bookingId}`, customerToken);
  console.log(`  booking ${booking.code} ${booking.status}/${booking.payment_status}`);

  // ───────── Pro (provider): requests, accept, en route, code entry ─────────
  console.log('Pro app (provider)');
  const p = await newPage(browser);
  await uiLogin(p, PRO, '077222222', 'pro-01-login');
  await T(p, 'Bright Spark Electrical').first().waitFor();
  await T(p, /You can take jobs|You cannot take jobs yet/).first().waitFor();
  if (await T(p, 'Pay commission').count()) {
    // Other testers' cash jobs left commission owed above the limit: show the blocker, then pay it in the app.
    await shot(p, 'pro-02-dashboard-blocker-balance', tid('blockers'));
    await T(p, 'Pay commission').first().click();
    await L(p, tid('pay-button')).waitFor();
    await shot(p, 'pro-02b-pay-commission');
    await L(p, tid('pay-button')).click();
    await T(p, 'Check your phone', { exact: true }).waitFor({ timeout: 20000 });
    await shot(p, 'pro-02c-pay-commission-waiting');
    await L(p, tid('simulate-approve')).click();
    await T(p, 'Payment received', { exact: true }).waitFor({ timeout: 20000 });
    await shot(p, 'pro-02d-pay-commission-paid');
    await p.goto(`${PRO}/`, { waitUntil: 'networkidle' });
    await T(p, 'You can take jobs').waitFor({ timeout: 20000 });
  }
  await shot(p, 'pro-02-dashboard-balance');
  await p.goto(`${PRO}/jobs`, { waitUntil: 'networkidle' });
  await L(p, tid(`job-${booking.code}`)).waitFor({ timeout: 20000 });
  await shot(p, 'pro-03-job-requests', tid(`job-${booking.code}`));
  await L(p, tid(`accept-${booking.code}`)).click();
  await p.waitForURL(/\/job\//, { timeout: 20000 });
  const accepted = await api('GET', `/bookings/${bookingId}`, customerToken);
  booking.provider_id = accepted.provider_id;
  await L(p, tid('en-route')).click();
  await L(p, tid('job-code')).waitFor();
  await shot(p, 'pro-04-job-detail-start-code-entry', tid('code-entry'));

  // Customer sees the start code to give on arrival.
  await c.reload({ waitUntil: 'networkidle' });
  await shot(c, 'customer-11-booking-start-code', tid('start-code'));
  const startCode = (await L(c, tid('start-code')).innerText()).replace(/\D/g, '');
  await L(p, tid('job-code')).fill(startCode);
  await L(p, tid('submit-code')).click();
  await T(p, 'Finish job').first().waitFor();
  await c.reload({ waitUntil: 'networkidle' });
  await shot(c, 'customer-12-booking-completion-code', tid('completion-code'));
  const doneCode = (await L(c, tid('completion-code')).innerText()).replace(/\D/g, '');
  await L(p, tid('job-code')).fill(doneCode);
  await shot(p, 'pro-05-job-detail-complete-code-entry', tid('code-entry'));
  await L(p, tid('submit-code')).click();
  await T(p, 'Job finished. Well done!').first().waitFor();
  await shot(p, 'pro-06-job-completed-earning');

  await c.reload({ waitUntil: 'networkidle' });
  await T(c, 'Rate the job', { exact: true }).waitFor();
  await shot(c, 'customer-13-booking-timeline-rate');
  await api('POST', '/reviews', customerToken, { bookingId, rating: 5, comment: 'Quick and tidy (screenshot run)' });

  // ───────── Customer: verify, wallet, bookings, Krio ─────────
  const brightBadges = (await api('GET', `/providers/${booking.provider_id}`)).badges;
  const idBadge = brightBadges.find((b) => b.code === 'NATIONAL_ID') ?? brightBadges[0];
  await c.goto(`${CUSTOMER}/verify`, { waitUntil: 'networkidle' });
  await L(c, tid('badge-code-input')).fill(idBadge.verification_code);
  await L(c, tid('verify-button')).click();
  await L(c, tid('verify-result')).waitFor();
  await shot(c, 'customer-14-verify-valid', tid('verify-result'));
  await L(c, tid('badge-code-input')).fill('FXB-NOPE00');
  await L(c, tid('verify-button')).click();
  await T(c, 'NOT VALID').waitFor();
  await shot(c, 'customer-15-verify-not-valid', tid('verify-result'));
  await c.goto(`${CUSTOMER}/provider/${booking.provider_id}`, { waitUntil: 'networkidle' });
  await T(c, 'Trust badges').waitFor();
  await shot(c, 'customer-05-provider-profile');
  await c.goto(`${CUSTOMER}/wallet`, { waitUntil: 'networkidle' });
  await L(c, tid('wallet-balance')).waitFor();
  await shot(c, 'customer-16-wallet');
  await c.goto(`${CUSTOMER}/bookings`, { waitUntil: 'networkidle' });
  await T(c, 'Past', { exact: true }).first().click();
  await T(c, booking.service_name).first().waitFor();
  await shot(c, 'customer-17-my-bookings');
  await c.goto(`${CUSTOMER}/profile`, { waitUntil: 'networkidle' });
  await T(c, 'Krio', { exact: true }).click();
  await c.goto(`${CUSTOMER}/`, { waitUntil: 'networkidle' });
  await T(c, 'Wetin pwɛl?').waitFor();
  await shot(c, 'customer-18-home-krio');
  await api('PATCH', '/auth/me', customerToken, { language: 'en' });

  // ───────── Pro (provider): badges, earnings, plans ─────────
  await p.goto(`${PRO}/badges`, { waitUntil: 'networkidle' });
  await L(p, tid('badge-card')).waitFor({ timeout: 20000 });
  await shot(p, 'pro-07-badges-card');
  await shot(p, 'pro-08-badges-apply', tid('badge-TRADE_CERTIFIED'));
  await p.goto(`${PRO}/earnings`, { waitUntil: 'networkidle' });
  await L(p, tid('earnings-card')).waitFor();
  await T(p, 'Job earning').first().waitFor();
  await shot(p, 'pro-09-earnings');
  await p.goto(`${PRO}/plans`, { waitUntil: 'networkidle' });
  await L(p, tid('plan-standard')).waitFor();
  await shot(p, 'pro-10-plans');
  await L(p, tid('calc')).click();
  await shot(p, 'pro-11-what-will-i-earn', tid('calc-result'));

  // ───────── Pro (pending provider): approval banner and accept blockers ─────────
  console.log('Pro app (pending provider)');
  const pending = await newPage(browser);
  await uiLogin(pending, PRO, '030555556');
  await L(pending, tid('blockers')).waitFor({ timeout: 20000 });
  await shot(pending, 'pro-12-dashboard-pending-blockers', tid('pending-banner'));
  await shot(pending, 'pro-13-dashboard-blockers-cta', tid('blockers'));

  // ───────── Serviceman: a plumbing job assigned by Salone Plumbing ─────────
  console.log('Pro app (serviceman)');
  const plumbToken = await apiLogin('076333333');
  const plumb = await api('GET', '/providers/me', plumbToken);
  const zoneId = plumb.zones[0].id;
  const serviceId = (plumb.services.find((s) => /leak/i.test(s.name)) ?? plumb.services[0]).id;
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const quote = await api('POST', '/pricing/quote', customerToken, { serviceId, zoneId, scheduledAt: `${tomorrow}T10:00:00Z`, providerId: plumb.id });
  const job = await api('POST', '/bookings', customerToken, {
    quoteId: quote.id,
    paymentMethod: 'cash',
    address: { area: 'Wilkinson Road', landmark: 'Opposite Lumley police station, yellow house with black gate', contactPhone: CUSTOMER_PHONE },
    notes: 'Kitchen tap leaking under the sink',
  });
  await api('POST', `/bookings/${job.id}/accept`, plumbToken);
  const team = await api('GET', '/providers/me/servicemen', plumbToken);
  const ibrahim = team.find((s) => s.phone === '+23278444444' && s.active) ?? team.find((s) => s.active);
  await api('POST', `/bookings/${job.id}/assign`, plumbToken, { servicemanId: ibrahim.id });
  const s = await newPage(browser);
  await uiLogin(s, PRO, '078444444');
  await L(s, tid(`job-${job.code}`)).waitFor({ timeout: 20000 });
  await shot(s, 'pro-14-serviceman-jobs');
  await L(s, tid(`job-${job.code}`)).click();
  await L(s, tid('call-customer')).waitFor();
  await shot(s, 'pro-15-serviceman-job-detail');

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'index.txt'), shots.join('\n') + '\n');
  console.log(`\n${shots.length} screenshots in ${OUT}`);
})().catch(async (e) => {
  console.error('SCREENSHOT RUN FAILED:', e);
  for (const [i, pg] of openPages.entries()) {
    console.error(`  page ${i}: ${pg.url()}`);
    await pg.screenshot({ path: path.join(OUT, `_failure-${i}.png`) }).catch(() => {});
  }
  process.exit(1);
  process.exit(1);
});
