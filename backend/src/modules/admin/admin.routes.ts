import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db.js';
import { badRequest } from '../../lib/errors.js';
import { ah, paging, parse } from '../../lib/http.js';
import { authenticate, currentUser, requireRole } from '../auth/auth.js';
import { providerBadges } from '../badges/badges.service.js';
import { balance, entries } from '../wallet/ledger.js';
import { getAllSettings, SETTING_DEFAULTS, setSetting, type SettingKey } from '../settings/settings.service.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('admin'));

adminRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const [totals] = await query(
      `SELECT
         count(*)::int AS bookings,
         count(*) FILTER (WHERE status = 'completed')::int AS completed,
         count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         count(*) FILTER (WHERE status IN ('pending','accepted','assigned','en_route','in_progress'))::int AS active,
         count(*) FILTER (WHERE status = 'disputed')::int AS disputed,
         COALESCE(sum(total_minor) FILTER (WHERE status = 'completed'), 0)::bigint AS gmv_minor,
         COALESCE(sum(surcharge_minor) FILTER (WHERE status = 'completed'), 0)::bigint AS peak_surcharge_minor,
         COALESCE(sum(commission_minor) FILTER (WHERE status = 'completed'), 0)::bigint AS commission_minor,
         COALESCE(sum(commission_gst_minor) FILTER (WHERE status = 'completed'), 0)::bigint AS gst_minor,
         count(*) FILTER (WHERE payment_method = 'cash')::int AS cash_bookings,
         count(*) FILTER (WHERE channel = 'ussd')::int AS ussd_bookings
       FROM bookings WHERE created_at > now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    const [byMethod, byZone, byCategory, providers, pendingBadges, pendingPayouts, daily, revenue] = await Promise.all([
      query(`SELECT payment_method, count(*)::int AS n, COALESCE(sum(total_minor),0)::bigint AS amount_minor FROM bookings
              WHERE created_at > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 2 DESC`, [String(days)]),
      query(`SELECT z.name, count(b.*)::int AS n, COALESCE(sum(b.total_minor) FILTER (WHERE b.status='completed'),0)::bigint AS gmv_minor
               FROM zones z LEFT JOIN bookings b ON b.zone_id = z.id AND b.created_at > now() - ($1 || ' days')::interval
              GROUP BY z.name ORDER BY 2 DESC`, [String(days)]),
      query(`SELECT c.name, count(b.*)::int AS n FROM bookings b JOIN services s ON s.id = b.service_id JOIN categories c ON c.id = s.category_id
              WHERE b.created_at > now() - ($1 || ' days')::interval GROUP BY c.name ORDER BY 2 DESC`, [String(days)]),
      query(`SELECT status, count(*)::int AS n FROM providers GROUP BY status`),
      query(`SELECT count(*)::int AS n FROM provider_badges WHERE status = 'pending'`),
      query(`SELECT count(*)::int AS n, COALESCE(sum(amount_minor),0)::bigint AS amount_minor FROM payouts WHERE status IN ('requested','approved')`),
      query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS bookings,
                    COALESCE(sum(total_minor) FILTER (WHERE status='completed'),0)::bigint AS gmv_minor
               FROM bookings WHERE created_at > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 1`, [String(days)]),
      query(`SELECT account_type, entry_type, COALESCE(sum(amount_minor),0)::bigint AS amount_minor FROM ledger_entries
              WHERE account_type IN ('platform_revenue','platform_tax') GROUP BY 1,2 ORDER BY 1,2`),
    ]);
    const [owed] = await query(
      `SELECT COALESCE(sum(-b), 0)::bigint AS owed_minor, count(*)::int AS providers FROM (
         SELECT sum(amount_minor) AS b FROM ledger_entries WHERE account_type = 'provider' GROUP BY account_id) t WHERE b < 0`,
    );
    res.json({
      period_days: days,
      totals,
      by_payment_method: byMethod,
      by_zone: byZone,
      by_category: byCategory,
      providers,
      pending_badge_reviews: pendingBadges[0].n,
      pending_payouts: pendingPayouts[0],
      cash_commission_outstanding: owed,
      daily,
      platform_ledger: revenue,
    });
  }),
);

adminRouter.get(
  '/providers',
  ah(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const q = typeof req.query.q === 'string' ? req.query.q : null;
    res.json(
      await query(
        `SELECT p.*, u.name AS owner_name, u.phone AS owner_phone, cp.name AS plan_name,
                COALESCE((SELECT sum(amount_minor) FROM ledger_entries l WHERE l.account_type = 'provider' AND l.account_id = p.id), 0)::bigint AS balance_minor,
                (SELECT count(*)::int FROM provider_badges pb WHERE pb.provider_id = p.id AND pb.status = 'pending') AS pending_badges,
                COALESCE((SELECT array_agg(z.name) FROM provider_zones pz JOIN zones z ON z.id = pz.zone_id WHERE pz.provider_id = p.id), '{}') AS zones
           FROM providers p JOIN users u ON u.id = p.owner_user_id LEFT JOIN commission_plans cp ON cp.id = p.commission_plan_id
          WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.business_name ILIKE '%'||$2||'%' OR u.phone LIKE '%'||$2||'%')
          ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`,
        [status, q, limit, offset],
      ),
    );
  }),
);

adminRouter.get('/providers/:id/badges', ah(async (req, res) => res.json(await providerBadges(req.params.id))));

adminRouter.get(
  '/providers/:id/ledger',
  ah(async (req, res) => {
    const { limit, offset } = paging(req.query);
    res.json({ balance_minor: await balance('provider', req.params.id), entries: await entries('provider', req.params.id, limit, offset) });
  }),
);

adminRouter.get(
  '/users',
  ah(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const role = typeof req.query.role === 'string' ? req.query.role : null;
    res.json(
      await query(
        `SELECT id, phone, name, role, language, status, phone_verified_at, created_at FROM users
          WHERE ($1::text IS NULL OR role::text = $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [role, limit, offset],
      ),
    );
  }),
);

adminRouter.post(
  '/users/:id/status',
  ah(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['active', 'blocked']) }), req.body);
    const [u] = await query('UPDATE users SET status = $2 WHERE id = $1 RETURNING id, status', [req.params.id, status]);
    if (status === 'blocked') await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.params.id]);
    res.json(u);
  }),
);

adminRouter.get('/settings', ah(async (_req, res) => res.json(await getAllSettings())));

adminRouter.put(
  '/settings',
  ah(async (req, res) => {
    const body = parse(z.record(z.unknown()), req.body);
    for (const [key, value] of Object.entries(body)) {
      if (!(key in SETTING_DEFAULTS)) throw badRequest('unknown_setting', `Unknown setting ${key}`);
      const def = SETTING_DEFAULTS[key as SettingKey];
      if (typeof def !== typeof value || Array.isArray(def) !== Array.isArray(value)) throw badRequest('invalid_setting', `${key} must be a ${Array.isArray(def) ? 'list' : typeof def}`);
      await setSetting(key as SettingKey, value);
    }
    await query(`INSERT INTO audit_logs (actor_id, action, entity, data) VALUES ($1,'settings.update','settings',$2)`, [currentUser(req).id, JSON.stringify(body)]);
    res.json(await getAllSettings());
  }),
);

adminRouter.get(
  '/sms-outbox',
  ah(async (req, res) => {
    const { limit, offset } = paging(req.query);
    res.json(await query('SELECT * FROM sms_outbox ORDER BY id DESC LIMIT $1 OFFSET $2', [limit, offset]));
  }),
);

adminRouter.get(
  '/audit-logs',
  ah(async (req, res) => {
    const { limit, offset } = paging(req.query);
    res.json(
      await query(
        `SELECT a.*, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    );
  }),
);
