import { one, query, type Db, pool } from '../../db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { config } from '../../config.js';
import { getSetting } from '../settings/settings.service.js';
import { computePrice, type PriceResult, type PricingRule } from './pricing.engine.js';

const RULE_COLUMNS = `id, name, label, kind, zone_id, category_id, days_of_week,
  start_time::text AS start_time, end_time::text AS end_time,
  to_char(date_from, 'YYYY-MM-DD') AS date_from, to_char(date_to, 'YYYY-MM-DD') AS date_to,
  recurring_yearly, min_demand_ratio, multiplier, flat_fee_minor, stackable, priority, active`;

export async function loadRules(db: Db = pool, includeInactive = false): Promise<PricingRule[]> {
  return query<PricingRule>(
    `SELECT ${RULE_COLUMNS} FROM pricing_rules ${includeInactive ? '' : 'WHERE active'} ORDER BY priority DESC, name`,
    [],
    db,
  );
}

export async function getRule(id: string): Promise<PricingRule | undefined> {
  return one<PricingRule>(`SELECT ${RULE_COLUMNS} FROM pricing_rules WHERE id = $1`, [id]);
}

/** Open requests per available provider in a zone around a time. Drives demand-based surge rules. */
export async function demandRatio(zoneId: string, categoryIds: string[], at: Date, db: Db = pool): Promise<number> {
  const windowHours = await getSetting('pricing.demand_window_hours', db);
  const row = await one(
    `SELECT
       (SELECT count(*)::int FROM bookings b JOIN services s ON s.id = b.service_id
         WHERE b.zone_id = $1 AND b.status IN ('pending','accepted','assigned','en_route')
           AND s.category_id = ANY($2::uuid[])
           AND b.scheduled_at BETWEEN $3::timestamptz - ($4 || ' hours')::interval AND $3::timestamptz + ($4 || ' hours')::interval) AS open,
       (SELECT count(DISTINCT p.id)::int FROM providers p
          JOIN provider_zones pz ON pz.provider_id = p.id AND pz.zone_id = $1
          JOIN provider_services ps ON ps.provider_id = p.id
          JOIN services s ON s.id = ps.service_id AND s.category_id = ANY($2::uuid[])
         WHERE p.status = 'active' AND p.is_available) AS supply`,
    [zoneId, categoryIds, at.toISOString(), String(windowHours)],
    db,
  );
  const open = row?.open ?? 0;
  const supply = row?.supply ?? 0;
  return supply === 0 ? open : Math.round((open / supply) * 100) / 100;
}

export interface QuoteRequest {
  serviceId: string;
  zoneId: string;
  scheduledAt?: Date;
  quantity?: number;
  isEmergency?: boolean;
  providerId?: string;
  customerId?: string | null;
}

async function serviceContext(serviceId: string, providerId: string | undefined, db: Db) {
  const svc = await one(
    `SELECT s.*, c.parent_id FROM services s JOIN categories c ON c.id = s.category_id WHERE s.id = $1 AND s.active`,
    [serviceId],
    db,
  );
  if (!svc) throw notFound('Service');
  let unitPriceMinor: number = svc.base_price_minor;
  if (providerId) {
    const ps = await one(
      `SELECT ps.price_override_minor FROM provider_services ps JOIN providers p ON p.id = ps.provider_id
        WHERE ps.provider_id = $1 AND ps.service_id = $2 AND p.status = 'active'`,
      [providerId, serviceId],
      db,
    );
    if (!ps) throw badRequest('provider_does_not_offer_service', 'This provider does not offer that service');
    if (ps.price_override_minor != null) unitPriceMinor = ps.price_override_minor;
  }
  return { svc, unitPriceMinor, categoryIds: [svc.category_id, svc.parent_id].filter(Boolean) as string[] };
}

export async function priceFor(req: QuoteRequest, db: Db = pool): Promise<PriceResult & { unitPriceMinor: number; demandRatio: number }> {
  const scheduledAt = req.scheduledAt ?? new Date();
  const { unitPriceMinor, categoryIds } = await serviceContext(req.serviceId, req.providerId, db);
  // Sequential on purpose: `db` may be a transaction client.
  const rules = await loadRules(db);
  const ratio = await demandRatio(req.zoneId, categoryIds, scheduledAt, db);
  const maxMultiplier = await getSetting('pricing.max_multiplier', db);
  const maxSurchargeMinor = await getSetting('pricing.max_surcharge_minor', db);
  const result = computePrice(
    { unitPriceMinor, quantity: req.quantity ?? 1, zoneId: req.zoneId, categoryIds, scheduledAt, isEmergency: !!req.isEmergency, demandRatio: ratio },
    rules,
    { maxMultiplier, maxSurchargeMinor },
  );
  return { ...result, unitPriceMinor, demandRatio: ratio };
}

/** Prices a job and locks the price for a short time, so the amount shown is the amount charged. */
export async function createQuote(req: QuoteRequest, db: Db = pool) {
  const scheduledAt = req.scheduledAt ?? new Date();
  if (scheduledAt.getTime() < Date.now() - 5 * 60_000) throw badRequest('scheduled_in_past', 'Pick a time in the future');
  const zone = await one('SELECT id FROM zones WHERE id = $1 AND active', [req.zoneId], db);
  if (!zone) throw notFound('Zone');
  const price = await priceFor({ ...req, scheduledAt }, db);
  return one(
    `INSERT INTO price_quotes (customer_id, service_id, provider_id, zone_id, scheduled_at, is_emergency, quantity,
                               subtotal_minor, surcharge_minor, total_minor, multiplier, breakdown, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + ($13 || ' seconds')::interval)
     RETURNING *`,
    [
      req.customerId ?? null, req.serviceId, req.providerId ?? null, req.zoneId, scheduledAt, !!req.isEmergency, req.quantity ?? 1,
      price.subtotalMinor, price.surchargeMinor, price.totalMinor, price.multiplier,
      JSON.stringify({ unitPriceMinor: price.unitPriceMinor, demandRatio: price.demandRatio, appliedRules: price.appliedRules, cappedBy: price.cappedBy, lines: price.lines }),
      String(config.quoteTtlSec),
    ],
    db,
  );
}
