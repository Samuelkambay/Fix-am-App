// End-to-end UI check against the live API: login → browse → price strip → checkout → mobile money → booking → verify.
// Usage: npm run build && npm run preview & node scripts/e2e.cjs [baseUrl]
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = path.join(__dirname, '..', 'screenshots');
// Full-page captures repeat fixed bars mid-image, so unpin them while shooting.
const shot = async (page, name) => {
  const style = await page.addStyleTag({ content: '.topbar,.bottom-nav{position:static!important}' });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await style.evaluate((el) => el.remove());
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const step = (s) => console.log(`✓ ${s}`);

  await page.goto(BASE);
  await page.waitForSelector('.cat-card:not(.skeleton)');
  await page.waitForSelector('.pro-card');
  await shot(page, '01-home');
  step('home renders categories and verified providers');

  // Login with phone + dev OTP.
  await page.goto(`${BASE}/login`);
  // A fresh Orange number each run: avoids the 3-codes-per-10-minutes limit and covers the new-user name step.
  const phone = `076${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  await page.fill('input[inputmode=tel]', phone);
  await page.click('text=Send code');
  await page.waitForSelector('.alert-info b');
  const code = await page.textContent('.alert-info b');
  await shot(page, '02-login-otp');
  await page.fill('input.otp', code.trim());
  await page.click('button:has-text("Log in")');
  await page.waitForSelector('input[placeholder^="e.g. Aminata"]');
  await page.fill('input[placeholder^="e.g. Aminata"]', 'Mariama Bangura');
  await page.click('button:has-text("Continue")');
  await page.waitForURL(`${BASE}/`);
  step(`new customer ${phone} signed up by OTP`);

  await page.click('.cat-card:has-text("Electrical")');
  await page.waitForSelector('.list-item');
  await shot(page, '03-category');
  await page.click('.list-item:has-text("fault finding")');
  await page.waitForSelector('.strip-col');
  await page.click('.day-chip:has-text("Tomorrow")');
  await page.waitForTimeout(600);
  await page.click('.strip-col:has(.strip-hour:text-is("6pm"))');
  await page.waitForSelector('.alert-warn');
  await shot(page, '04-service-peak-hour');
  step(`peak hour shows: ${(await page.textContent('.alert-warn')).trim()}`);
  await page.click('.strip-col:has(.strip-hour:text-is("10am"))');
  await page.click('button:has-text("See the price")');
  await page.waitForURL('**/checkout');
  await page.waitForSelector('.lock');
  step('quote locked: ' + (await page.textContent('.lock')).trim());

  await page.fill('input[placeholder^="e.g. Behind"]', 'Opposite Victoria Park market, green gate');
  await page.waitForSelector('.method.selected');
  await shot(page, '05-checkout');
  const selected = (await page.textContent('.method.selected')).trim();
  step(`suggested wallet for an Orange number: ${selected}`);
  await page.click('button:has-text("Confirm booking")');
  await page.waitForURL('**/bookings/*?pay=1');
  await page.waitForSelector('.code-card');

  await page.click('.card button.btn-primary:has-text("Pay Le")');
  await page.waitForSelector('text=Waiting for approval');
  await shot(page, '06-payment-waiting');
  step('payment pending: ' + (await page.textContent('.pay-status .lead')).trim());
  await page.click('text=Simulate approval');
  await page.waitForSelector('text=Paid Le');
  await page.waitForTimeout(2000);
  await page.waitForSelector('.pay-paid');
  await shot(page, '07-booking-paid-start-code');
  const startCode = (await page.textContent('.code-digits')).trim();
  step(`booking paid; start code shown: ${startCode}`);

  await page.goto(`${BASE}/bookings`);
  await page.waitForSelector('.list-item');
  await shot(page, '08-bookings');

  // Verify a real badge code and a fake one.
  const res = await page.request.get(`${BASE}/api/v1/providers?limit=1`);
  const pro = (await res.json())[0];
  const profile = await (await page.request.get(`${BASE}/api/v1/providers/${pro.id}`)).json();
  const idBadge = profile.badges.find((b) => b.code === 'NATIONAL_ID') ?? profile.badges[0];
  await page.goto(`${BASE}/verify/${idBadge.verification_code}`);
  await page.waitForSelector('.verdict.valid');
  await shot(page, '09-verify-valid');
  await page.goto(`${BASE}/verify/FXB-FAKE99`);
  await page.waitForSelector('.verdict.invalid');
  await shot(page, '10-verify-invalid');
  step('badge verification: valid and invalid codes render');

  await page.goto(`${BASE}/providers/${pro.id}`);
  await page.waitForSelector('.badge-row');
  await shot(page, '11-provider-profile');

  await page.goto(`${BASE}/wallet`);
  await page.waitForSelector('.balance-card');
  await shot(page, '12-wallet');
  step('wallet renders');

  // Desktop views.
  const desk = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const dp = await desk.newPage();
  await dp.goto(BASE);
  await dp.waitForSelector('.pro-card');
  await shot(dp, '13-desktop-home');
  await dp.goto(`${BASE}/service/${(await (await dp.request.get(`${BASE}/api/v1/catalog/services?q=fault`)).json())[0].id}`);
  await dp.waitForSelector('.strip-col');
  await dp.click('.day-chip:has-text("Tomorrow")');
  await dp.waitForTimeout(500);
  await dp.click('.strip-col:has(.strip-hour:text-is("7pm"))');
  await shot(dp, '14-desktop-service');

  await browser.close();
  if (errors.length) {
    console.error('Browser errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('All UI checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
