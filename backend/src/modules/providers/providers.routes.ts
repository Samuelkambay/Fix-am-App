import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { ah, paging, parse } from '../../lib/http.js';
import { detectOperator, normalizeSlPhone, OPERATOR_WALLET } from '../../lib/phone.js';
import { authenticate, currentUser, requireRole, type AuthUser } from '../auth/auth.js';
import { approvedBadgeCodes, grantSystemBadge, providerBadges } from '../badges/badges.service.js';
import { acceptBlockers } from '../bookings/bookings.service.js';
import { commissionFor, providerPlan } from '../commission/commission.service.js';
import { sendSms } from '../notifications/sms.js';
import { getSetting } from '../settings/settings.service.js';
import { balance } from '../wallet/ledger.js';

export const providersRouter = Router();

const gatewayEnum = z.enum(['orange_money', 'afrimoney', 'qmoney', 'monime']);
const serviceOffer = z.object({ serviceId: z.string().uuid(), priceOverrideMinor: z.number().int().nonnegative().nullable().optional() });

const GATEWAY_OPERATOR: Record<string, string | null> = { orange_money: 'orange', afrimoney: 'africell', qmoney: 'qcell', monime: null };

/** Payouts go to a wallet on the number's own network (Monime accepts any). */
async function checkPayoutWallet(gateway: string | undefined | null, msisdn: string | undefined | null) {
  if (!gateway || !msisdn) return;
  const need = GATEWAY_OPERATOR[gateway];
  if (!need) return;
  const op = detectOperator(msisdn, await getSetting('phone_prefixes'));
  if (op !== 'unknown' && op !== need) {
    throw badRequest('wallet_network_mismatch', `${msisdn} is on ${op}; choose ${OPERATOR_WALLET[op]} for payouts or use another number`, {
      suggestedGateway: OPERATOR_WALLET[op],
    });
  }
}

function requireProvider(u: AuthUser): string {
  if (u.role !== 'provider' || !u.providerId) throw forbidden('Provider account required');
  return u.providerId;
}

async function setZones(providerId: string, zoneIds: string[], c: any) {
  await c.query('DELETE FROM provider_zones WHERE provider_id = $1', [providerId]);
  for (const z of new Set(zoneIds)) await c.query('INSERT INTO provider_zones (provider_id, zone_id) VALUES ($1,$2)', [providerId, z]);
}

async function setServices(providerId: string, offers: z.infer<typeof serviceOffer>[], c: any) {
  await c.query('DELETE FROM provider_services WHERE provider_id = $1', [providerId]);
  for (const o of offers) {
    await c.query('INSERT INTO provider_services (provider_id, service_id, price_override_minor) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
      providerId, o.serviceId, o.priceOverrideMinor ?? null,
    ]);
  }
}

/** Turns a logged-in customer account into a provider (pending admin approval). */
providersRouter.post(
  '/register',
  authenticate,
  ah(async (req, res) => {
    const u = currentUser(req);
    if (u.role !== 'customer') throw conflict('already_registered', `This account is already a ${u.role}`);
    const b = parse(
      z.object({
        businessName: z.string().min(2).max(120),
        kind: z.enum(['individual', 'company']).default('individual'),
        bio: z.string().max(1000).optional(),
        zoneIds: z.array(z.string().uuid()).min(1),
        services: z.array(serviceOffer).min(1),
        payoutGateway: gatewayEnum.optional(),
        payoutMsisdn: z.string().optional(),
      }),
      req.body,
    );
    await checkPayoutWallet(b.payoutGateway, b.payoutMsisdn ? normalizeSlPhone(b.payoutMsisdn) : u.phone);
    const providerId = await tx(async (c) => {
      const plan = await one('SELECT id FROM commission_plans WHERE is_default', [], c);
      const p = await one(
        `INSERT INTO providers (owner_user_id, business_name, kind, bio, commission_plan_id, payout_gateway, payout_msisdn)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [u.id, b.businessName, b.kind, b.bio ?? null, plan?.id ?? null, b.payoutGateway ?? null, b.payoutMsisdn ? normalizeSlPhone(b.payoutMsisdn) : u.phone],
        c,
      );
      await c.query(`UPDATE users SET role = 'provider' WHERE id = $1`, [u.id]);
      await setZones(p.id, b.zoneIds, c);
      await setServices(p.id, b.services, c);
      await grantSystemBadge(p.id, 'PHONE_VERIFIED', 'Phone number verified by SMS code', c);
      return p.id as string;
    });
    res.status(201).json(await one('SELECT * FROM providers WHERE id = $1', [providerId]));
  }),
);

/** Public search, ranked by trust (verified badges) and then rating. */
providersRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(z.object({ zoneId: z.string().uuid().optional(), serviceId: z.string().uuid().optional(), badge: z.string().optional() }), req.query);
    const { limit, offset } = paging(req.query);
    const rows = await query(
      `SELECT p.id, p.business_name, p.kind, p.bio, p.rating_avg, p.rating_count, p.completed_jobs, p.trust_score, p.is_available,
              ps.price_override_minor,
              COALESCE((SELECT array_agg(pb.badge_code ORDER BY bd.sort_order) FROM provider_badges pb JOIN badge_definitions bd ON bd.code = pb.badge_code
                         WHERE pb.provider_id = p.id AND pb.status = 'approved' AND (pb.expires_at IS NULL OR pb.expires_at > now())), '{}') AS badges
         FROM providers p
         LEFT JOIN provider_services ps ON ps.provider_id = p.id AND ps.service_id = $2
        WHERE p.status = 'active'
          AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM provider_zones pz WHERE pz.provider_id = p.id AND pz.zone_id = $1))
          AND ($2::uuid IS NULL OR ps.service_id IS NOT NULL)
          AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM provider_badges pb WHERE pb.provider_id = p.id AND pb.badge_code = $3 AND pb.status = 'approved'))
        ORDER BY p.is_available DESC, p.trust_score DESC, p.rating_avg DESC, p.completed_jobs DESC
        LIMIT $4 OFFSET $5`,
      [q.zoneId ?? null, q.serviceId ?? null, q.badge ?? null, limit, offset],
    );
    res.json(rows);
  }),
);

// ───────── Own provider account ─────────
providersRouter.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const id = requireProvider(currentUser(req));
    const p = await one('SELECT * FROM providers WHERE id = $1', [id]);
    const [zones, services, badges, plan, bal, blockers, sub] = await Promise.all([
      query('SELECT z.* FROM provider_zones pz JOIN zones z ON z.id = pz.zone_id WHERE pz.provider_id = $1', [id]),
      query(
        `SELECT s.id, s.name, s.base_price_minor, ps.price_override_minor, c.name AS category_name
           FROM provider_services ps JOIN services s ON s.id = ps.service_id JOIN categories c ON c.id = s.category_id WHERE ps.provider_id = $1`,
        [id],
      ),
      providerBadges(id),
      providerPlan(id),
      balance('provider', id),
      acceptBlockers(id),
      one(`SELECT * FROM provider_subscriptions WHERE provider_id = $1 AND status = 'active' AND ends_at > now() ORDER BY ends_at DESC LIMIT 1`, [id]),
    ]);
    res.json({
      ...p,
      zones,
      services,
      badges,
      commission_plan: plan,
      active_subscription: sub ?? null,
      balance_minor: bal,
      commission_owed_minor: Math.max(-bal, 0),
      cash_commission_limit_minor: await getSetting('cash.max_commission_due_minor'),
      can_accept_jobs: blockers.length === 0,
      accept_blockers: blockers,
    });
  }),
);

providersRouter.patch(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const id = requireProvider(currentUser(req));
    const b = parse(
      z.object({
        businessName: z.string().min(2).max(120).optional(),
        bio: z.string().max(1000).optional(),
        isAvailable: z.boolean().optional(),
        payoutGateway: gatewayEnum.optional(),
        payoutMsisdn: z.string().optional(),
      }),
      req.body,
    );
    const current = await one('SELECT payout_gateway, payout_msisdn FROM providers WHERE id = $1', [id]);
    await checkPayoutWallet(b.payoutGateway ?? current.payout_gateway, b.payoutMsisdn ? normalizeSlPhone(b.payoutMsisdn) : current.payout_msisdn);
    res.json(
      await one(
        `UPDATE providers SET business_name = COALESCE($2, business_name), bio = COALESCE($3, bio), is_available = COALESCE($4, is_available),
                payout_gateway = COALESCE($5, payout_gateway), payout_msisdn = COALESCE($6, payout_msisdn)
          WHERE id = $1 RETURNING *`,
        [id, b.businessName ?? null, b.bio ?? null, b.isAvailable ?? null, b.payoutGateway ?? null, b.payoutMsisdn ? normalizeSlPhone(b.payoutMsisdn) : null],
      ),
    );
  }),
);

providersRouter.put(
  '/me/zones',
  authenticate,
  ah(async (req, res) => {
    const id = requireProvider(currentUser(req));
    const { zoneIds } = parse(z.object({ zoneIds: z.array(z.string().uuid()).min(1) }), req.body);
    await tx((c) => setZones(id, zoneIds, c));
    res.json({ ok: true });
  }),
);

providersRouter.put(
  '/me/services',
  authenticate,
  ah(async (req, res) => {
    const id = requireProvider(currentUser(req));
    const { services } = parse(z.object({ services: z.array(serviceOffer).min(1) }), req.body);
    await tx((c) => setServices(id, services, c));
    res.json({ ok: true });
  }),
);

/** What the provider takes home from a job at a given price under their current plan. */
providersRouter.get(
  '/me/commission-preview',
  authenticate,
  ah(async (req, res) => {
    const id = requireProvider(currentUser(req));
    const q = parse(
      z.object({ serviceId: z.string().uuid(), subtotalMinor: z.coerce.number().int().nonnegative(), surchargeMinor: z.coerce.number().int().nonnegative().default(0) }),
      req.query,
    );
    const svc = await one('SELECT s.category_id, c.parent_id FROM services s JOIN categories c ON c.id = s.category_id WHERE s.id = $1', [q.serviceId]);
    if (!svc) throw notFound('Service');
    res.json(await commissionFor({ providerId: id, categoryId: svc.category_id, parentCategoryId: svc.parent_id, subtotalMinor: q.subtotalMinor, surchargeMinor: q.surchargeMinor, discountMinor: 0 }));
  }),
);

providersRouter.get(
  '/me/subscriptions',
  authenticate,
  ah(async (req, res) => {
    const id = requireProvider(currentUser(req));
    res.json(
      await query(
        `SELECT s.*, cp.name AS plan_name, cp.subscription_fee_minor FROM provider_subscriptions s JOIN commission_plans cp ON cp.id = s.plan_id
          WHERE s.provider_id = $1 ORDER BY s.created_at DESC`,
        [id],
      ),
    );
  }),
);

/** Switch to a pay-per-job (commission) plan. Subscription plans are bought through POST /payments. */
providersRouter.put(
  '/me/plan',
  authenticate,
  ah(async (req, res) => {
    const id = requireProvider(currentUser(req));
    const { planId } = parse(z.object({ planId: z.string().uuid() }), req.body);
    const plan = await one(`SELECT id, model FROM commission_plans WHERE id = $1 AND active`, [planId]);
    if (!plan) throw notFound('Plan');
    if (plan.model !== 'commission') throw badRequest('payment_required', 'Subscription plans start when you pay for them');
    await query('UPDATE providers SET commission_plan_id = $2 WHERE id = $1', [id, plan.id]);
    res.json(await providerPlan(id));
  }),
);

// ───────── Servicemen (a provider's team) ─────────
providersRouter.get(
  '/me/servicemen',
  authenticate,
  ah(async (req, res) => {
    const id = requireProvider(currentUser(req));
    res.json(
      await query(
        `SELECT s.id, s.active, s.created_at, u.id AS user_id, u.name, u.phone,
                (SELECT count(*)::int FROM bookings b WHERE b.serviceman_id = s.id AND b.status IN ('assigned','en_route','in_progress')) AS active_jobs
           FROM servicemen s JOIN users u ON u.id = s.user_id WHERE s.provider_id = $1 ORDER BY u.name`,
        [id],
      ),
    );
  }),
);

providersRouter.post(
  '/me/servicemen',
  authenticate,
  ah(async (req, res) => {
    const u = currentUser(req);
    const providerId = requireProvider(u);
    const b = parse(z.object({ name: z.string().min(2).max(120), phone: z.string().transform(normalizeSlPhone) }), req.body);
    const created = await tx(async (c) => {
      let user = await one('SELECT * FROM users WHERE phone = $1', [b.phone], c);
      if (user && user.role !== 'customer' && user.role !== 'serviceman') throw conflict('phone_in_use', `That number belongs to a ${user.role} account`);
      if (user) {
        const other = await one('SELECT provider_id FROM servicemen WHERE user_id = $1 AND active', [user.id], c);
        if (other && other.provider_id !== providerId) throw conflict('serviceman_taken', 'That person already works for another provider');
        await c.query(`UPDATE users SET role = 'serviceman', name = COALESCE(name, $2) WHERE id = $1`, [user.id, b.name]);
      } else {
        user = await one(`INSERT INTO users (phone, name, role) VALUES ($1,$2,'serviceman') RETURNING *`, [b.phone, b.name], c);
      }
      return one(
        `INSERT INTO servicemen (user_id, provider_id) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET provider_id = EXCLUDED.provider_id, active = true RETURNING *`,
        [user.id, providerId],
        c,
      );
    });
    const p = await one('SELECT business_name FROM providers WHERE id = $1', [providerId]);
    await sendSms(b.phone, `FixAm: ${p.business_name} added you to their team. Download the FixAm Pro app and log in with this number.`);
    res.status(201).json(created);
  }),
);

providersRouter.patch(
  '/me/servicemen/:id',
  authenticate,
  ah(async (req, res) => {
    const providerId = requireProvider(currentUser(req));
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const row = await one('UPDATE servicemen SET active = $3 WHERE id = $1 AND provider_id = $2 RETURNING *', [req.params.id, providerId, active]);
    if (!row) throw notFound('Serviceman');
    if (!active) await query(`UPDATE users SET role = 'customer' WHERE id = $1 AND role = 'serviceman'`, [row.user_id]);
    res.json(row);
  }),
);

/** Public profile. Placed last so /me routes are not swallowed by :id. */
providersRouter.get(
  '/:id',
  ah(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw badRequest('invalid_id', 'Invalid provider id');
    const p = await one(
      `SELECT id, business_name, kind, bio, rating_avg, rating_count, completed_jobs, trust_score, is_available, created_at
         FROM providers WHERE id = $1 AND status = 'active'`,
      [req.params.id],
    );
    if (!p) throw notFound('Provider');
    const [badges, services, zones] = await Promise.all([
      query(
        `SELECT bd.code, bd.name, bd.kind, bd.icon, pb.verification_code, pb.issued_at, pb.expires_at
           FROM provider_badges pb JOIN badge_definitions bd ON bd.code = pb.badge_code
          WHERE pb.provider_id = $1 AND pb.status = 'approved' AND (pb.expires_at IS NULL OR pb.expires_at > now()) ORDER BY bd.sort_order`,
        [p.id],
      ),
      query(
        `SELECT s.id, s.name, COALESCE(ps.price_override_minor, s.base_price_minor) AS price_minor, s.price_unit, s.unit_label
           FROM provider_services ps JOIN services s ON s.id = ps.service_id WHERE ps.provider_id = $1 AND s.active ORDER BY s.name`,
        [p.id],
      ),
      query('SELECT z.id, z.name FROM provider_zones pz JOIN zones z ON z.id = pz.zone_id WHERE pz.provider_id = $1', [p.id]),
    ]);
    res.json({ ...p, badges, badge_codes: await approvedBadgeCodes(p.id), services, zones });
  }),
);

// ───────── Admin ─────────
providersRouter.post(
  '/:id/status',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(z.object({ status: z.enum(['active', 'suspended', 'pending']), note: z.string().max(500).optional() }), req.body);
    const p = await one('UPDATE providers SET status = $2 WHERE id = $1 RETURNING *', [req.params.id, b.status]);
    if (!p) throw notFound('Provider');
    await query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, data) VALUES ($1,$2,'provider',$3,$4)`, [
      currentUser(req).id, `provider.${b.status}`, p.id, JSON.stringify({ note: b.note }),
    ]);
    const owner = await one('SELECT phone FROM users WHERE id = $1', [p.owner_user_id]);
    if (b.status === 'active') await sendSms(owner.phone, 'FixAm: your provider account is approved. You can now receive jobs.');
    if (b.status === 'suspended') await sendSms(owner.phone, `FixAm: your provider account is suspended${b.note ? `: ${b.note}` : ''}. Contact support.`);
    res.json(p);
  }),
);
