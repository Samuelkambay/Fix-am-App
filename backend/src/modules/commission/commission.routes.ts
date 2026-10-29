import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { ah, parse } from '../../lib/http.js';
import { authenticate, currentUser, requireRole } from '../auth/auth.js';
import { getSetting } from '../settings/settings.service.js';
import { computeCommission } from './commission.engine.js';
import { listPlans } from './commission.service.js';

export const commissionRouter = Router();

const tierSchema = z.object({ min_gmv_minor: z.number().int().nonnegative(), rate_bps: z.number().int().min(0).max(10000) });
const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(2),
  model: z.enum(['commission', 'subscription', 'hybrid']),
  defaultRateBps: z.number().int().min(0).max(10000),
  subscriptionRateBps: z.number().int().min(0).max(10000).default(0),
  surchargeRateBps: z.number().int().min(0).max(10000).nullable().optional(),
  minCommissionMinor: z.number().int().nonnegative().default(0),
  maxCommissionMinor: z.number().int().positive().nullable().optional(),
  subscriptionFeeMinor: z.number().int().nonnegative().default(0),
  subscriptionPeriodDays: z.number().int().positive().default(30),
  tiers: z.array(tierSchema).default([]),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Public: providers compare pay-per-job and subscription plans in the app. */
commissionRouter.get(
  '/plans',
  ah(async (_req, res) => {
    const plans = await listPlans();
    res.json(plans.filter((p) => p.active));
  }),
);

const admin = [authenticate, requireRole('admin')];

commissionRouter.get('/plans/all', ...admin, ah(async (_req, res) => res.json(await listPlans())));

commissionRouter.post(
  '/plans',
  ...admin,
  ah(async (req, res) => {
    const b = parse(planSchema, req.body);
    const plan = await tx(async (c) => {
      if (b.isDefault) await c.query('UPDATE commission_plans SET is_default = false WHERE is_default');
      return one(
        `INSERT INTO commission_plans (code, name, model, default_rate_bps, subscription_rate_bps, surcharge_rate_bps, min_commission_minor,
                                       max_commission_minor, subscription_fee_minor, subscription_period_days, tiers, is_default, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,false),COALESCE($13,true)) RETURNING *`,
        [b.code, b.name, b.model, b.defaultRateBps, b.subscriptionRateBps, b.surchargeRateBps ?? null, b.minCommissionMinor,
         b.maxCommissionMinor ?? null, b.subscriptionFeeMinor, b.subscriptionPeriodDays, JSON.stringify(b.tiers), b.isDefault ?? null, b.active ?? null],
        c,
      );
    });
    res.status(201).json(plan);
  }),
);

commissionRouter.patch(
  '/plans/:id',
  ...admin,
  ah(async (req, res) => {
    const b = parse(planSchema.partial(), req.body);
    const plan = await tx(async (c) => {
      if (b.isDefault) await c.query('UPDATE commission_plans SET is_default = false WHERE is_default AND id <> $1', [req.params.id]);
      return one(
        `UPDATE commission_plans SET name = COALESCE($2,name), model = COALESCE($3,model), default_rate_bps = COALESCE($4,default_rate_bps),
                subscription_rate_bps = COALESCE($5,subscription_rate_bps),
                surcharge_rate_bps = CASE WHEN $6::boolean THEN $7 ELSE surcharge_rate_bps END,
                min_commission_minor = COALESCE($8,min_commission_minor),
                max_commission_minor = CASE WHEN $9::boolean THEN $10 ELSE max_commission_minor END,
                subscription_fee_minor = COALESCE($11,subscription_fee_minor), subscription_period_days = COALESCE($12,subscription_period_days),
                tiers = COALESCE($13,tiers), is_default = COALESCE($14,is_default), active = COALESCE($15,active)
          WHERE id = $1 RETURNING *`,
        [req.params.id, b.name, b.model, b.defaultRateBps, b.subscriptionRateBps,
         b.surchargeRateBps !== undefined, b.surchargeRateBps ?? null, b.minCommissionMinor,
         b.maxCommissionMinor !== undefined, b.maxCommissionMinor ?? null,
         b.subscriptionFeeMinor, b.subscriptionPeriodDays, b.tiers ? JSON.stringify(b.tiers) : null, b.isDefault, b.active],
        c,
      );
    });
    if (!plan) throw notFound('Commission plan');
    res.json(plan);
  }),
);

/** Replaces a plan's per-category rates, e.g. 10% on cleaning, 18% on electrical. */
commissionRouter.put(
  '/plans/:id/category-rates',
  ...admin,
  ah(async (req, res) => {
    const { rates } = parse(z.object({ rates: z.array(z.object({ categoryId: z.string().uuid(), rateBps: z.number().int().min(0).max(10000) })) }), req.body);
    await tx(async (c) => {
      await c.query('DELETE FROM commission_category_rates WHERE plan_id = $1', [req.params.id]);
      for (const r of rates) await c.query('INSERT INTO commission_category_rates (plan_id, category_id, rate_bps) VALUES ($1,$2,$3)', [req.params.id, r.categoryId, r.rateBps]);
    });
    res.json((await listPlans()).find((p) => p.id === req.params.id));
  }),
);

/** Puts a provider on a plan and/or gives them a negotiated rate (null clears it). */
commissionRouter.patch(
  '/providers/:providerId',
  ...admin,
  ah(async (req, res) => {
    const b = parse(z.object({ planId: z.string().uuid().optional(), overrideBps: z.number().int().min(0).max(10000).nullable().optional() }), req.body);
    const row = await one(
      `UPDATE providers SET commission_plan_id = COALESCE($2, commission_plan_id),
              commission_override_bps = CASE WHEN $3::boolean THEN $4 ELSE commission_override_bps END
        WHERE id = $1 RETURNING id, business_name, commission_plan_id, commission_override_bps`,
      [req.params.providerId, b.planId ?? null, b.overrideBps !== undefined, b.overrideBps ?? null],
    );
    if (!row) throw notFound('Provider');
    await query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, data) VALUES ($1,'commission.provider_update','provider',$2,$3)`, [
      currentUser(req).id, row.id, JSON.stringify(b),
    ]);
    res.json(row);
  }),
);

/** Admin calculator: what a plan does to a job of a given size. */
commissionRouter.post(
  '/simulate',
  ...admin,
  ah(async (req, res) => {
    const b = parse(
      z.object({
        planId: z.string().uuid(),
        subtotalMinor: z.number().int().nonnegative(),
        surchargeMinor: z.number().int().nonnegative().default(0),
        discountMinor: z.number().int().nonnegative().default(0),
        categoryId: z.string().uuid().optional(),
        providerOverrideBps: z.number().int().min(0).max(10000).nullable().default(null),
        hasActiveSubscription: z.boolean().default(false),
        trailingGmvMinor: z.number().int().nonnegative().default(0),
      }),
      req.body,
    );
    const plan = await one('SELECT * FROM commission_plans WHERE id = $1', [b.planId]);
    if (!plan) throw notFound('Commission plan');
    const cat = b.categoryId ? await one('SELECT rate_bps FROM commission_category_rates WHERE plan_id = $1 AND category_id = $2', [plan.id, b.categoryId]) : null;
    res.json(
      computeCommission({
        ...b,
        plan,
        categoryRateBps: cat?.rate_bps ?? null,
        gstRateBps: await getSetting('commission.gst_rate_bps'),
        gstBorneBy: await getSetting('commission.gst_borne_by'),
      }),
    );
  }),
);
