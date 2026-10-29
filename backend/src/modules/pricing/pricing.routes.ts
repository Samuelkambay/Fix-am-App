import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { ah, parse } from '../../lib/http.js';
import { authenticate, optionalAuth, requireRole } from '../auth/auth.js';
import { getSetting } from '../settings/settings.service.js';
import { computePrice } from './pricing.engine.js';
import { createQuote, getRule, loadRules, priceFor } from './pricing.service.js';

export const pricingRouter = Router();

const quoteSchema = z.object({
  serviceId: z.string().uuid(),
  zoneId: z.string().uuid(),
  scheduledAt: z.coerce.date().optional(),
  quantity: z.number().positive().max(1000).optional(),
  isEmergency: z.boolean().optional(),
  providerId: z.string().uuid().optional(),
});

/** Locks a price for 15 minutes. The booking must reference this quote. */
pricingRouter.post(
  '/quote',
  optionalAuth,
  ah(async (req, res) => {
    const b = parse(quoteSchema, req.body);
    res.status(201).json(await createQuote({ ...b, customerId: req.user?.id ?? null }));
  }),
);

/** Hour-by-hour prices for one day, so the app can show "book at 10:00 and save Le 40". */
pricingRouter.get(
  '/day-curve',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        serviceId: z.string().uuid(),
        zoneId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        providerId: z.string().uuid().optional(),
        isEmergency: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    const hours = [];
    for (let h = 6; h <= 22; h++) {
      const at = new Date(`${q.date}T${String(h).padStart(2, '0')}:00:00Z`); // Freetown is UTC+0
      const p = await priceFor({ serviceId: q.serviceId, zoneId: q.zoneId, providerId: q.providerId, scheduledAt: at, isEmergency: q.isEmergency === 'true' });
      // Bookable = at least an hour from now, matching the one-hour notice the apps give fixers.
      const bookable = at.getTime() >= Date.now() + 60 * 60_000;
      hours.push({ at: at.toISOString(), hour: h, bookable, totalMinor: p.totalMinor, surchargeMinor: p.surchargeMinor, multiplier: p.multiplier, labels: p.appliedRules.map((r) => r.label) });
    }
    const open = hours.filter((h) => h.bookable);
    const cheapest = open.length ? Math.min(...open.map((h) => h.totalMinor)) : null;
    res.json({ date: q.date, hours: hours.map((h) => ({ ...h, isCheapest: h.bookable && h.totalMinor === cheapest })) });
  }),
);

// ───────── Admin: rule management ─────────
const ruleSchema = z.object({
  name: z.string().min(2),
  label: z.string().min(2),
  kind: z.enum(['time_window', 'holiday', 'seasonal', 'demand', 'emergency']),
  zoneId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  recurringYearly: z.boolean().optional(),
  minDemandRatio: z.number().positive().nullable().optional(),
  multiplier: z.number().min(1).max(5),
  flatFeeMinor: z.number().int().nonnegative().optional(),
  stackable: z.boolean().optional(),
  priority: z.number().int().optional(),
  active: z.boolean().optional(),
});

const admin = [authenticate, requireRole('admin')];

pricingRouter.get('/rules', ...admin, ah(async (_req, res) => res.json(await loadRules(undefined, true))));

pricingRouter.post(
  '/rules',
  ...admin,
  ah(async (req, res) => {
    const b = parse(ruleSchema, req.body);
    const row = await one(
      `INSERT INTO pricing_rules (name, label, kind, zone_id, category_id, days_of_week, start_time, end_time, date_from, date_to,
                                  recurring_yearly, min_demand_ratio, multiplier, flat_fee_minor, stackable, priority, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,false),$12,$13,COALESCE($14,0),COALESCE($15,false),COALESCE($16,0),COALESCE($17,true))
       RETURNING id`,
      [b.name, b.label, b.kind, b.zoneId ?? null, b.categoryId ?? null, b.daysOfWeek ?? null, b.startTime ?? null, b.endTime ?? null,
       b.dateFrom ?? null, b.dateTo ?? null, b.recurringYearly ?? null, b.minDemandRatio ?? null, b.multiplier, b.flatFeeMinor ?? null,
       b.stackable ?? null, b.priority ?? null, b.active ?? null],
    );
    res.status(201).json(await getRule(row.id));
  }),
);

pricingRouter.patch(
  '/rules/:id',
  ...admin,
  ah(async (req, res) => {
    const existing = await getRule(req.params.id);
    if (!existing) throw notFound('Pricing rule');
    const b = parse(ruleSchema.partial(), req.body);
    // Explicit nulls clear a field; omitted fields keep their value.
    const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : v);
    await query(
      `UPDATE pricing_rules SET name=$2, label=$3, kind=$4, zone_id=$5, category_id=$6, days_of_week=$7, start_time=$8, end_time=$9,
              date_from=$10, date_to=$11, recurring_yearly=$12, min_demand_ratio=$13, multiplier=$14, flat_fee_minor=$15,
              stackable=$16, priority=$17, active=$18 WHERE id=$1`,
      [existing.id, pick(b.name, existing.name), pick(b.label, existing.label), pick(b.kind, existing.kind),
       pick(b.zoneId, existing.zone_id), pick(b.categoryId, existing.category_id), pick(b.daysOfWeek, existing.days_of_week),
       pick(b.startTime, existing.start_time), pick(b.endTime, existing.end_time), pick(b.dateFrom, existing.date_from),
       pick(b.dateTo, existing.date_to), pick(b.recurringYearly, existing.recurring_yearly), pick(b.minDemandRatio, existing.min_demand_ratio),
       pick(b.multiplier, existing.multiplier), pick(b.flatFeeMinor, existing.flat_fee_minor), pick(b.stackable, existing.stackable),
       pick(b.priority, existing.priority), pick(b.active, existing.active)],
    );
    res.json(await getRule(existing.id));
  }),
);

pricingRouter.delete(
  '/rules/:id',
  ...admin,
  ah(async (req, res) => {
    await query('DELETE FROM pricing_rules WHERE id = $1', [req.params.id]);
    res.status(204).end();
  }),
);

/** Dry-runs the current rules for an arbitrary scenario without creating a quote. */
pricingRouter.post(
  '/simulate',
  ...admin,
  ah(async (req, res) => {
    const b = parse(
      z.object({
        unitPriceMinor: z.number().int().nonnegative(),
        quantity: z.number().positive().default(1),
        zoneId: z.string().uuid(),
        categoryIds: z.array(z.string().uuid()).default([]),
        scheduledAt: z.coerce.date(),
        isEmergency: z.boolean().default(false),
        demandRatio: z.number().nonnegative().default(0),
      }),
      req.body,
    );
    const [rules, maxMultiplier, maxSurchargeMinor] = await Promise.all([
      loadRules(),
      getSetting('pricing.max_multiplier'),
      getSetting('pricing.max_surcharge_minor'),
    ]);
    res.json(computePrice(b, rules, { maxMultiplier, maxSurchargeMinor }));
  }),
);
