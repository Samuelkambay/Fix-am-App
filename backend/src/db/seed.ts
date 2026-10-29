import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { one, pool, tx } from '../db.js';
import { hashPassword, readableCode } from '../lib/crypto.js';
import { migrate } from './migrate.js';
import { BADGES, CATALOG, COMMISSION_PLANS, PRICING_RULES, ZONES } from './seed-data.js';

export async function resetDatabase() {
  const { rows } = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`);
  if (rows.length) await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

/** Zones, catalog, pricing rules, commission plans and badge definitions. */
export async function seedReference(c: pg.PoolClient) {
  for (const z of ZONES) {
    await c.query(`INSERT INTO zones (name, district, city, center_lat, center_lng, radius_km) VALUES ($1,$2,$3,$4,$5,$6)`, [z.name, z.district, z.city, z.lat, z.lng, z.r]);
  }
  const categoryIds: Record<string, string> = {};
  let order = 0;
  for (const cat of CATALOG) {
    const row = await one(`INSERT INTO categories (slug, name, icon, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`, [cat.slug, cat.name, cat.icon, order++], c);
    categoryIds[cat.slug] = row.id;
    for (const s of cat.services) {
      await c.query(
        `INSERT INTO services (category_id, name, description, base_price_minor, price_unit, unit_label, duration_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, s.name, s.description ?? null, s.price, s.unit ?? 'fixed', s.unitLabel ?? null, s.minutes ?? 60],
      );
    }
  }
  for (const r of PRICING_RULES) {
    await c.query(
      `INSERT INTO pricing_rules (name, label, kind, category_id, days_of_week, start_time, end_time, date_from, date_to, recurring_yearly,
                                  min_demand_ratio, multiplier, flat_fee_minor, stackable, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [r.name, r.label, r.kind, r.category ? categoryIds[r.category] : null, r.days ?? null, r.start ?? null, r.end ?? null,
       r.from ?? null, r.to ?? null, r.yearly ?? false, r.ratio ?? null, r.multiplier, r.flat ?? 0, r.stackable ?? false, r.priority],
    );
  }
  for (const p of COMMISSION_PLANS) {
    const plan = await one(
      `INSERT INTO commission_plans (code, name, model, default_rate_bps, subscription_rate_bps, surcharge_rate_bps, min_commission_minor,
                                     max_commission_minor, subscription_fee_minor, subscription_period_days, tiers, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [p.code, p.name, p.model, p.defaultRateBps, p.subscriptionRateBps, p.surchargeRateBps, p.minCommissionMinor, p.maxCommissionMinor,
       p.feeMinor, p.periodDays, JSON.stringify(p.tiers), p.isDefault],
      c,
    );
    for (const [slug, bps] of Object.entries(p.categoryRates)) {
      await c.query(`INSERT INTO commission_category_rates (plan_id, category_id, rate_bps) VALUES ($1,$2,$3)`, [plan.id, categoryIds[slug], bps]);
    }
  }
  for (const b of BADGES) {
    await c.query(
      `INSERT INTO badge_definitions (code, name, description, kind, required_documents, validity_days, criteria, trust_weight, icon, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [b.code, b.name, b.description, b.kind, b.docs, b.validity, b.criteria ? JSON.stringify(b.criteria) : null, b.weight, b.icon, b.order],
    );
  }
}

async function user(c: pg.PoolClient, phone: string, name: string, role: string, password?: string) {
  return one(
    `INSERT INTO users (phone, name, role, password_hash, phone_verified_at) VALUES ($1,$2,$3,$4,now()) RETURNING id`,
    [phone, name, role, password ? hashPassword(password) : null],
    c,
  );
}

async function badge(c: pg.PoolClient, providerId: string, code: string, status: 'approved' | 'pending', days: number | null) {
  await c.query(
    `INSERT INTO provider_badges (provider_id, badge_code, status, verification_code, documents, issued_at, expires_at)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $3 = 'approved' THEN now() END,
             CASE WHEN $3 = 'approved' AND $6::int IS NOT NULL THEN now() + ($6 || ' days')::interval END)`,
    [providerId, code, status, `FXB-${readableCode(6)}`, JSON.stringify(status === 'pending' ? [{ type: 'id_document', url: '/demo/id.jpg' }, { type: 'selfie', url: '/demo/selfie.jpg' }] : []), days],
  );
}

/** Demo accounts so every app can be explored immediately. Not for production. */
export async function seedDemo(c: pg.PoolClient) {
  const zone = async (name: string) => (await one('SELECT id FROM zones WHERE name = $1', [name], c)).id as string;
  const services = async (slug: string) =>
    (await c.query('SELECT s.id FROM services s JOIN categories c ON c.id = s.category_id WHERE c.slug = $1', [slug])).rows.map((r) => r.id as string);
  const plan = async (code: string) => (await one('SELECT id FROM commission_plans WHERE code = $1', [code], c)).id as string;

  await user(c, '+23276000001', 'FixAm Admin', 'admin', 'Admin@123');
  await user(c, '+23276111111', 'Aminata Kamara', 'customer');
  await user(c, '+23277111112', 'Hawa Jalloh', 'customer');

  const providers = [
    { phone: '+23277222222', owner: 'Mohamed Sesay', name: 'Bright Spark Electrical', kind: 'individual', status: 'active', zones: ['Freetown - Central', 'Freetown - East End'],
      trades: ['electrical'], plan: 'standard', gw: 'afrimoney', badges: [['NATIONAL_ID', 'approved', 730], ['POLICE_CLEARANCE', 'approved', 365], ['TRADE_CERTIFIED', 'pending', null]],
      bio: 'Licensed electrician, 9 years. Wiring, faults, changeover switches.', rating: [4.8, 31], jobs: 42 },
    { phone: '+23276333333', owner: 'Fatmata Conteh', name: 'Salone Plumbing Works', kind: 'company', status: 'active', zones: ['Freetown - West End', 'Freetown - Central', 'Freetown - Goderich & Lakka'],
      trades: ['plumbing', 'cleaning'], plan: 'growth', gw: 'orange_money', badges: [['NATIONAL_ID', 'approved', 730], ['BUSINESS_REGISTERED', 'approved', 365]],
      bio: 'Plumbing, polytanks, borehole pumps and tank cleaning across the West End.', rating: [4.6, 18], jobs: 25 },
    { phone: '+23276555555', owner: 'Ishmael Turay', name: 'PowerUp Solar & Generators', kind: 'company', status: 'active', zones: ['Freetown - Central', 'Freetown - East End', 'Freetown - West End', 'Waterloo'],
      trades: ['generator-solar', 'electrical'], plan: 'pro_monthly', gw: 'orange_money', badges: [['NATIONAL_ID', 'approved', 730], ['BUSINESS_REGISTERED', 'approved', 365], ['TRADE_CERTIFIED', 'approved', null]],
      bio: 'Generator servicing and solar installs. Subscribed Pro partner.', rating: [4.9, 12], jobs: 14 },
    { phone: '+23230555556', owner: 'Abu Koroma', name: 'Bo Cool Fridge & AC', kind: 'individual', status: 'pending', zones: ['Bo'],
      trades: ['cooling'], plan: 'standard', gw: 'afrimoney', badges: [['NATIONAL_ID', 'pending', null]], bio: 'AC and fridge repair in Bo town.', rating: [0, 0], jobs: 0 },
  ];

  for (const p of providers) {
    const u = await user(c, p.phone, p.owner, 'provider');
    const row = await one(
      `INSERT INTO providers (owner_user_id, business_name, kind, bio, status, commission_plan_id, payout_gateway, payout_msisdn, rating_avg, rating_count, completed_jobs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [u.id, p.name, p.kind, p.bio, p.status, await plan(p.plan), p.gw, p.phone, p.rating[0], p.rating[1], p.jobs],
      c,
    );
    for (const z of p.zones) await c.query('INSERT INTO provider_zones VALUES ($1,$2)', [row.id, await zone(z)]);
    for (const t of p.trades) for (const s of await services(t)) await c.query('INSERT INTO provider_services (provider_id, service_id) VALUES ($1,$2)', [row.id, s]);
    await badge(c, row.id, 'PHONE_VERIFIED', 'approved', null);
    for (const [code, status, days] of p.badges) await badge(c, row.id, code as string, status as any, days as number | null);
    if (p.plan === 'pro_monthly') {
      await c.query(
        `INSERT INTO provider_subscriptions (provider_id, plan_id, status, starts_at, ends_at) VALUES ($1,$2,'active', now() - interval '3 days', now() + interval '27 days')`,
        [row.id, await plan(p.plan)],
      );
    }
    if (p.name === 'Salone Plumbing Works') {
      const sm = await user(c, '+23278444444', 'Ibrahim Bangura', 'serviceman');
      await c.query('INSERT INTO servicemen (user_id, provider_id) VALUES ($1,$2)', [sm.id, row.id]);
    }
  }
  await c.query(`
    UPDATE providers p SET trust_score = COALESCE((SELECT sum(bd.trust_weight) FROM provider_badges pb JOIN badge_definitions bd ON bd.code = pb.badge_code
                                                   WHERE pb.provider_id = p.id AND pb.status = 'approved'), 0)`);
}

async function main() {
  await migrate();
  const reset = process.argv.includes('--reset');
  const existing = await one('SELECT 1 FROM zones LIMIT 1');
  if (existing && !reset) {
    console.log('Database already seeded. Run with --reset to wipe and reseed.');
    return;
  }
  await resetDatabase();
  await tx(async (c) => {
    await seedReference(c);
    if (!process.argv.includes('--no-demo')) await seedDemo(c);
  });
  console.log('Seeded Sierra Leone reference data and demo accounts.');
  console.log('Admin panel login: 076 000 001 / Admin@123. All other demo accounts log in with an SMS code (shown in dev).');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
