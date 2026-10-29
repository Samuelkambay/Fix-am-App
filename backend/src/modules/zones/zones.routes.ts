import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { ah, parse } from '../../lib/http.js';
import { authenticate, optionalAuth, requireRole } from '../auth/auth.js';
import { resolveZone } from './zones.service.js';

export const zonesRouter = Router();

const zoneSchema = z.object({
  name: z.string().min(2),
  district: z.string().min(2),
  city: z.string().min(2),
  centerLat: z.number().min(6.8).max(10.1), // Sierra Leone bounding box
  centerLng: z.number().min(-13.4).max(-10.2),
  radiusKm: z.number().positive().max(100),
  active: z.boolean().optional(),
});

zonesRouter.get(
  '/',
  optionalAuth,
  ah(async (req, res) => {
    const all = req.user?.role === 'admin' && req.query.includeInactive === 'true';
    res.json(await query('SELECT * FROM zones WHERE ($1::boolean OR active) ORDER BY city, name', [all]));
  }),
);

zonesRouter.get(
  '/resolve',
  ah(async (req, res) => {
    const { lat, lng } = parse(z.object({ lat: z.coerce.number(), lng: z.coerce.number() }), req.query);
    const zone = await resolveZone(lat, lng);
    if (!zone) throw notFound('Service zone for this location');
    res.json(zone);
  }),
);

zonesRouter.post(
  '/',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(zoneSchema, req.body);
    res.status(201).json(
      await one(
        `INSERT INTO zones (name, district, city, center_lat, center_lng, radius_km, active)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true)) RETURNING *`,
        [b.name, b.district, b.city, b.centerLat, b.centerLng, b.radiusKm, b.active ?? null],
      ),
    );
  }),
);

zonesRouter.patch(
  '/:id',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(zoneSchema.partial(), req.body);
    const row = await one(
      `UPDATE zones SET name = COALESCE($2,name), district = COALESCE($3,district), city = COALESCE($4,city),
              center_lat = COALESCE($5,center_lat), center_lng = COALESCE($6,center_lng),
              radius_km = COALESCE($7,radius_km), active = COALESCE($8,active)
        WHERE id = $1 RETURNING *`,
      [req.params.id, b.name, b.district, b.city, b.centerLat, b.centerLng, b.radiusKm, b.active],
    );
    if (!row) throw notFound('Zone');
    res.json(row);
  }),
);
