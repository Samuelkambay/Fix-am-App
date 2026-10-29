import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ah, parse } from '../../lib/http.js';
import { authenticate, optionalAuth, requireRole } from '../auth/auth.js';

const wantsInactive = (req: { user?: { role: string }; query: Record<string, unknown> }) =>
  req.user?.role === 'admin' && req.query.includeInactive === 'true';

export const catalogRouter = Router();

const categorySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  nameKri: z.string().optional(),
  icon: z.string().optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

const serviceSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(2),
  nameKri: z.string().optional(),
  description: z.string().optional(),
  basePriceMinor: z.number().int().nonnegative(),
  priceUnit: z.enum(['fixed', 'hourly', 'per_unit']).default('fixed'),
  unitLabel: z.string().optional(),
  durationMinutes: z.number().int().positive().default(60),
  active: z.boolean().optional(),
});

catalogRouter.get(
  '/categories',
  optionalAuth,
  ah(async (req, res) => {
    const rows = await query(
      `SELECT c.*, (SELECT count(*)::int FROM services s WHERE s.category_id = c.id AND s.active) AS service_count
         FROM categories c WHERE ($1::boolean OR c.active) ORDER BY c.sort_order, c.name`,
      [wantsInactive(req)],
    );
    const roots = rows.filter((r) => !r.parent_id).map((r) => ({ ...r, children: rows.filter((c) => c.parent_id === r.id) }));
    res.json(roots);
  }),
);

catalogRouter.post(
  '/categories',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(categorySchema, req.body);
    res.status(201).json(
      await one(
        `INSERT INTO categories (slug, name, name_kri, icon, parent_id, sort_order, active)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),COALESCE($7,true)) RETURNING *`,
        [b.slug, b.name, b.nameKri ?? null, b.icon ?? null, b.parentId ?? null, b.sortOrder ?? null, b.active ?? null],
      ),
    );
  }),
);

catalogRouter.patch(
  '/categories/:id',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(categorySchema.partial(), req.body);
    if (b.parentId === req.params.id) throw badRequest('invalid_parent', 'A category cannot be its own parent');
    const row = await one(
      `UPDATE categories SET slug = COALESCE($2,slug), name = COALESCE($3,name), name_kri = COALESCE($4,name_kri),
              icon = COALESCE($5,icon), sort_order = COALESCE($6,sort_order), active = COALESCE($7,active),
              parent_id = CASE WHEN $8::boolean THEN $9::uuid ELSE parent_id END
        WHERE id = $1 RETURNING *`,
      [req.params.id, b.slug, b.name, b.nameKri, b.icon, b.sortOrder, b.active, b.parentId !== undefined, b.parentId ?? null],
    );
    if (!row) throw notFound('Category');
    res.json(row);
  }),
);

catalogRouter.get(
  '/services',
  optionalAuth,
  ah(async (req, res) => {
    const q = parse(
      z.object({ categoryId: z.string().uuid().optional(), zoneId: z.string().uuid().optional(), q: z.string().optional() }),
      req.query,
    );
    // With a zone, only list services at least one active provider in that zone offers.
    const rows = await query(
      `SELECT s.*, c.name AS category_name, c.slug AS category_slug
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE ($4::boolean OR s.active)
          AND ($1::uuid IS NULL OR s.category_id = $1 OR c.parent_id = $1)
          AND ($2::text IS NULL OR s.name ILIKE '%' || $2 || '%' OR s.description ILIKE '%' || $2 || '%')
          AND ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM provider_services ps
                  JOIN providers p ON p.id = ps.provider_id AND p.status = 'active'
                  JOIN provider_zones pz ON pz.provider_id = p.id AND pz.zone_id = $3
                 WHERE ps.service_id = s.id))
        ORDER BY c.sort_order, s.name`,
      [q.categoryId ?? null, q.q ?? null, q.zoneId ?? null, wantsInactive(req)],
    );
    res.json(rows);
  }),
);

catalogRouter.get(
  '/services/:id',
  ah(async (req, res) => {
    const row = await one(
      `SELECT s.*, c.name AS category_name FROM services s JOIN categories c ON c.id = s.category_id WHERE s.id = $1`,
      [req.params.id],
    );
    if (!row) throw notFound('Service');
    res.json(row);
  }),
);

catalogRouter.post(
  '/services',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(serviceSchema, req.body);
    res.status(201).json(
      await one(
        `INSERT INTO services (category_id, name, name_kri, description, base_price_minor, price_unit, unit_label, duration_minutes, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true)) RETURNING *`,
        [b.categoryId, b.name, b.nameKri ?? null, b.description ?? null, b.basePriceMinor, b.priceUnit, b.unitLabel ?? null, b.durationMinutes, b.active ?? null],
      ),
    );
  }),
);

catalogRouter.patch(
  '/services/:id',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(serviceSchema.partial(), req.body);
    const row = await one(
      `UPDATE services SET category_id = COALESCE($2,category_id), name = COALESCE($3,name), name_kri = COALESCE($4,name_kri),
              description = COALESCE($5,description), base_price_minor = COALESCE($6,base_price_minor),
              price_unit = COALESCE($7,price_unit), unit_label = COALESCE($8,unit_label),
              duration_minutes = COALESCE($9,duration_minutes), active = COALESCE($10,active)
        WHERE id = $1 RETURNING *`,
      [req.params.id, b.categoryId, b.name, b.nameKri, b.description, b.basePriceMinor, b.priceUnit, b.unitLabel, b.durationMinutes, b.active],
    );
    if (!row) throw notFound('Service');
    res.json(row);
  }),
);
