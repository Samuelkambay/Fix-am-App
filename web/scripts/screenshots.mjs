#!/usr/bin/env node
// Captures every admin and provider page with Playwright (preinstalled Chromium) into ./screenshots.
//   npm run build && node scripts/screenshots.mjs
// Starts `vite preview` on :4173 (which proxies /api to the backend) unless BASE_URL is already serving.
// Uses the sessions cached by scripts/smoke.mjs for providers, so run the smoke test first.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'screenshots');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const API = process.env.API_URL || 'http://localhost:4000/api/v1';
mkdirSync(OUT, { recursive: true });

const cache = JSON.parse(readFileSync(join(HERE, '.smoke-tokens.json'), 'utf8'));
const saveCache = () => writeFileSync(join(HERE, '.smoke-tokens.json'), JSON.stringify(cache, null, 2));

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function session(name) {
  if (name === 'admin') {
    const r = await api('POST', '/auth/login', null, { phone: '076000001', password: 'Admin@123' });
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresIn: r.expiresIn, user: r.user };
  }
  const c = cache[name];
  if (!c?.refreshToken) throw new Error(`No cached session for ${name}. Run scripts/smoke.mjs first.`);
  const t = await api('POST', '/auth/refresh', null, { refreshToken: c.refreshToken });
  const user = await api('GET', '/auth/me', t.accessToken);
  cache[name] = { ...c, ...t, user };
  saveCache();
  return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn, user };
}

async function ensureServer() {
  try {
    await fetch(BASE);
    return null;
  } catch {
    /* start preview */
  }
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('Run `npm run build` first');
  const child = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      await fetch(BASE);
      return child;
    } catch {
      /* wait */
    }
  }
  child.kill();
  throw new Error('vite preview did not start');
}

const shots = [];
const problems = [];

async function main() {
  const server = await ensureServer();
  const browser = await chromium.launch();
  try {
    // Logged out
    await withContext(browser, null, {}, async (page) => {
      await go(page, '/login');
      await shot(page, '01-login');
    });

    // A clearly-labelled SAMPLE document image, uploaded through the same raw-body POST /uploads the UI uses,
    // so the admin document viewer has something real to show.
    await submitSampleApplication(browser, await session('plumbing'));

    // ───────── Admin ─────────
    const admin = await session('admin');
    const approved = await api('GET', '/badges/applications?status=approved', admin.accessToken);
    const validCode = approved.find((a) => a.badge_code === 'NATIONAL_ID' && a.business_name.startsWith('Bright'))?.verification_code ?? approved[0]?.verification_code;

    await withContext(browser, admin, {}, async (page) => {
      await go(page, '/admin/dashboard');
      await page.waitForSelector('.recharts-bar-rectangle, .recharts-surface', { timeout: 8000 }).catch(() => undefined);
      await shot(page, '02-admin-dashboard');

      await go(page, '/admin/bookings');
      await shot(page, '03-admin-bookings');
      await page.click('tbody tr.clickable');
      await settle(page, '.drawer');
      await shot(page, '04-admin-booking-detail', { fullPage: false });
      await page.keyboard.press('Escape');

      await go(page, '/admin/providers');
      await shot(page, '05-admin-providers');
      await page.click('tbody tr.clickable:has-text("Bright Spark")');
      await settle(page, '.drawer');
      await shot(page, '06-admin-provider-detail', { fullPage: false });
      await page.keyboard.press('Escape');

      await go(page, '/admin/badges');
      await shot(page, '07-admin-badge-queue');
      const doc = page.locator('.card:has-text("Salone Plumbing") button:has-text("Police clearance")').first();
      if (await doc.count()) {
        await doc.click();
        await page.waitForSelector('.modal img.doc-img, .modal .error-box', { timeout: 8000 });
        await shot(page, '08-admin-badge-document', { fullPage: false });
        await page.keyboard.press('Escape');
      } else problems.push('08: no uploaded document found to preview');
      if (validCode) {
        await page.fill('input[aria-label="Badge code"]', validCode);
        await page.click('button:has-text("Check code")');
        await page.waitForSelector('.banner-good, .banner-bad', { timeout: 8000 });
        await shot(page, '09-admin-badge-verify');
      }

      await go(page, '/admin/pricing');
      await shot(page, '10-admin-pricing-rules');
      await page.click('tr:has-text("Night call-out") button:has-text("Edit")');
      await settle(page, '.modal');
      await shot(page, '11-admin-pricing-rule-form', { fullPage: false });
      await page.keyboard.press('Escape');
      const sim = page.locator('.card:has-text("Simulator")');
      await sim.locator('input[type="datetime-local"]').fill(nextFriday22());
      await sim.locator('label:has-text("Urgent") input').check();
      await sim.locator('.field:has-text("Demand ratio") input').fill('3');
      await sim.locator('button:has-text("Simulate price")').click();
      await page.waitForSelector('text=Applied rules', { timeout: 8000 });
      await sim.scrollIntoViewIfNeeded();
      await sim.screenshot({ path: join(OUT, '12-admin-pricing-simulator.png') });
      shots.push('12-admin-pricing-simulator.png');

      await go(page, '/admin/commission');
      await shot(page, '13-admin-commission-plans');
      await page.click('.plan-card:has-text("Pay per job") button:has-text("Edit plan")');
      await settle(page, '.modal');
      await shot(page, '14-admin-commission-plan-form', { fullPage: false });
      await page.keyboard.press('Escape');
      await page.click('.plan-card:has-text("Pay per job") button:has-text("Category rates")');
      await settle(page, '.modal');
      await shot(page, '15-admin-commission-category-rates', { fullPage: false });
      await page.keyboard.press('Escape');
      const calc = page.locator('.card:has-text("Commission calculator")');
      await calc.locator('.field:has-text("Peak surcharge") input').fill('100');
      await calc.locator('button:has-text("Calculate")').click();
      await page.waitForSelector('text=Provider keeps', { timeout: 8000 });
      await calc.scrollIntoViewIfNeeded();
      await calc.screenshot({ path: join(OUT, '16-admin-commission-calculator.png') });
      shots.push('16-admin-commission-calculator.png');

      await go(page, '/admin/payments');
      await shot(page, '17-admin-payments');
      await page.click('.tab:has-text("Webhook events")');
      await settle(page);
      await shot(page, '18-admin-webhook-events');

      await go(page, '/admin/payouts');
      await page.selectOption('select[aria-label="Status filter"]', '');
      await settle(page);
      await shot(page, '19-admin-payouts');

      await go(page, '/admin/catalog');
      await shot(page, '20-admin-catalog-services');
      await page.click('.tab:has-text("Categories")');
      await settle(page);
      await shot(page, '21-admin-catalog-categories');
      await page.click('.tab:has-text("Services")');
      await settle(page);
      await page.click('tbody tr:first-child button:has-text("Edit")');
      await settle(page, '.modal');
      await shot(page, '22-admin-catalog-service-form', { fullPage: false });
      await page.keyboard.press('Escape');

      await go(page, '/admin/zones');
      await shot(page, '23-admin-zones');
      await go(page, '/admin/settings');
      await shot(page, '24-admin-settings');
      await go(page, '/admin/sms');
      await shot(page, '25-admin-sms-outbox');
      await go(page, '/admin/audit');
      await shot(page, '26-admin-audit-log');
    });

    // Dark theme sample
    await withContext(browser, admin, { colorScheme: 'dark' }, async (page) => {
      await go(page, '/admin/dashboard');
      await page.waitForSelector('.recharts-surface', { timeout: 8000 }).catch(() => undefined);
      await shot(page, '27-admin-dashboard-dark', { fullPage: false });
    });

    // ───────── Provider: Bright Spark (owes cash commission) ─────────
    const bright = await session('bright');
    await ensureOverCashLimit(bright.accessToken, (await session('customer')).accessToken);
    await withContext(browser, bright, {}, async (page) => {
      await go(page, '/provider/overview');
      await shot(page, '30-provider-overview');
      await go(page, '/provider/jobs');
      await shot(page, '31-provider-job-requests');
      await page.click('.tab:has-text("My jobs")');
      await settle(page);
      await shot(page, '32-provider-my-jobs');
      await page.click('tbody tr.clickable');
      await settle(page, '.drawer');
      await shot(page, '33-provider-job-detail', { fullPage: false });
      await page.keyboard.press('Escape');
      await go(page, '/provider/services');
      await shot(page, '34-provider-services-zones');
      await go(page, '/provider/badges');
      await shot(page, '35-provider-badges');
      await page.click('.badge-card:has-text("Registered business") button:has-text("Apply")');
      await settle(page, '.modal');
      await shot(page, '36-provider-badge-apply', { fullPage: false });
      await page.keyboard.press('Escape');
      await go(page, '/provider/plans');
      await page.click('button:has-text("Show my earning")');
      await page.waitForSelector('text=You keep', { timeout: 8000 });
      await shot(page, '37-provider-plans');
      await go(page, '/provider/wallet');
      await shot(page, '38-provider-wallet');
      // Payment flow (pays only Le 10 so the "you owe" state remains for the overview shots).
      await page.locator('#settle .field:has-text("Amount to pay") input').fill('10');
      await page.click('#settle button:has-text("now")');
      await settle(page, '.modal');
      await page.waitForTimeout(600);
      await shot(page, '39-provider-pay-commission', { fullPage: false });
      await page.click('.modal button:has-text("Pay Le")');
      await page.waitForSelector('.modal :text("Waiting for approval")', { timeout: 10000 });
      await shot(page, '40-provider-payment-waiting', { fullPage: false });
      await page.click('.modal button:has-text("Simulate approval")');
      await page.waitForSelector('.modal :text("Payment received")', { timeout: 10000 });
      await shot(page, '41-provider-payment-succeeded', { fullPage: false });
    });

    // Team lives with Salone Plumbing (it has servicemen and an active subscription).
    const plumbing = await session('plumbing');
    await withContext(browser, plumbing, {}, async (page) => {
      await go(page, '/provider/team');
      await shot(page, '42-provider-team');
      await go(page, '/provider/overview');
      await shot(page, '43-provider-overview-subscribed');
    });

    const bocool = await session('bocool');
    await withContext(browser, bocool, {}, async (page) => {
      await go(page, '/provider/overview');
      await shot(page, '44-provider-overview-pending');
    });

    const customer = await session('customer');
    await withContext(browser, customer, {}, async (page) => {
      await go(page, '/become-provider');
      await shot(page, '45-provider-registration');
    });

    // ───────── Mobile ─────────
    const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const bright2 = await session('bright');
    await withContext(browser, bright2, mobile, async (page) => {
      await go(page, '/provider/overview');
      await shot(page, '50-mobile-provider-overview');
      await page.click('button[aria-label="Open menu"]');
      await page.waitForTimeout(300);
      await shot(page, '51-mobile-provider-menu', { fullPage: false });
      await page.click('.sidebar a:has-text("Jobs")');
      await settle(page);
      await shot(page, '52-mobile-provider-jobs');
    });
    const admin2 = await session('admin');
    await withContext(browser, admin2, mobile, async (page) => {
      await go(page, '/admin/dashboard');
      await page.waitForSelector('.recharts-surface', { timeout: 8000 }).catch(() => undefined);
      await shot(page, '53-mobile-admin-dashboard');
    });
  } finally {
    await browser.close();
    server?.kill();
  }

  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, shots, problems }, null, 2));
  console.log(`\n${shots.length} screenshots in ${OUT}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else console.log('No console errors or failed API calls.');
}

// ───────── helpers ─────────
let current = '';

async function submitSampleApplication(browser, plumbing) {
  const mine = await api('GET', '/badges/mine', plumbing.accessToken);
  if (mine.some((b) => b.badge_code === 'POLICE_CLEARANCE' && (b.status === 'pending' || b.status === 'approved'))) return;
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  await page.setContent(`<body style="margin:0;font-family:Georgia,serif;background:#f4efe2">
    <div style="margin:24px;border:6px double #2f4f3a;padding:28px 36px;height:500px;box-sizing:border-box;position:relative">
      <div style="position:absolute;inset:0;display:grid;place-items:center;font:700 120px Arial;color:rgba(200,40,40,.16);transform:rotate(-18deg)">SAMPLE</div>
      <div style="text-align:center;font:700 13px Arial;letter-spacing:.2em;color:#2f4f3a">DEMO DATA – NOT A REAL DOCUMENT</div>
      <h1 style="text-align:center;margin:18px 0 4px;color:#1f3527">Police Clearance Certificate</h1>
      <p style="text-align:center;margin:0 0 26px;color:#555">FixAm Salone test fixture</p>
      <p style="font-size:18px;line-height:1.8">Name: <b>Fatmata Conteh</b><br>Business: <b>Salone Plumbing Works</b><br>Certificate no.: <b>SLP-2026-0042</b><br>Issued: <b>29 October 2026</b></p>
      <p style="position:absolute;bottom:26px;right:36px;color:#555">Generated by scripts/screenshots.mjs</p>
    </div></body>`);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  const up = await fetch(`${API}/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${plumbing.accessToken}`, 'Content-Type': 'image/png' }, body: png }).then((r) => r.json());
  await api('POST', '/badges/apply', plumbing.accessToken, { badgeCode: 'POLICE_CLEARANCE', documents: [{ type: 'police_clearance', url: up.url, number: 'SLP-2026-0042' }] });
  console.log('  (uploaded a SAMPLE police clearance for Salone Plumbing so the review queue has a real upload)');
}

/**
 * The provider overview should show the "you owe commission – pay now" blocker. Other people share this API,
 * so if Bright Spark is under the limit, run one real cash job (quote → book → accept → codes → complete).
 */
async function ensureOverCashLimit(providerToken, customerToken) {
  const me = await api('GET', '/providers/me', providerToken);
  if (me.commission_owed_minor > me.cash_commission_limit_minor + 5000) return;
  const [zones, services] = await Promise.all([api('GET', '/zones'), api('GET', '/catalog/services')]);
  const zone = zones.find((z) => z.name === 'Freetown - Central');
  const wiring = services.find((x) => x.name.toLowerCase().includes('house wiring'));
  const q = await api('POST', '/pricing/quote', customerToken, { serviceId: wiring.id, zoneId: zone.id, quantity: 25, scheduledAt: new Date(Date.now() + 3 * 3600_000) });
  const b = await api('POST', '/bookings', customerToken, {
    quoteId: q.id, paymentMethod: 'cash', notes: 'Rewire the whole house',
    address: { area: 'Tengbeh Town', landmark: 'Up the hill from the Mormon church, two-storey house' },
  });
  await api('POST', `/bookings/${b.id}/accept`, providerToken);
  await api('POST', `/bookings/${b.id}/en-route`, providerToken);
  await api('POST', `/bookings/${b.id}/start`, providerToken, { code: (await api('GET', `/bookings/${b.id}`, customerToken)).start_code });
  await api('POST', `/bookings/${b.id}/complete`, providerToken, { code: (await api('GET', `/bookings/${b.id}`, customerToken)).completion_code });
  console.log('  (ran a cash job so Bright Spark owes commission above the limit)');
}

async function withContext(browser, sess, opts, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...opts });
  if (sess) await ctx.addInitScript((s) => window.localStorage.setItem('fixam.session', s), JSON.stringify(sess));
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${current}: console error: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${current}: page error: ${e.message}`));
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/') && r.status() >= 400) problems.push(`${current}: ${r.request().method()} ${u.replace(/^.*\/api\/v1/, '')} → ${r.status()}`);
  });
  try {
    await fn(page);
  } catch (e) {
    problems.push(`${current}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: join(OUT, `error-${current || 'unknown'}.png`) }).catch(() => undefined);
  } finally {
    await ctx.close();
  }
}

async function go(page, path) {
  current = path;
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(page);
}

async function settle(page, selector) {
  if (selector) await page.waitForSelector(selector, { timeout: 8000 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.loading-block'), null, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function shot(page, name, { fullPage = true } = {}) {
  current = name;
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  shots.push(`${name}.png`);
  console.log(`  ✓ ${name}.png`);
}

function nextFriday22() {
  const d = new Date();
  d.setUTCHours(22, 0, 0, 0);
  while (d.getUTCDay() !== 5 || d < new Date()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 16);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
