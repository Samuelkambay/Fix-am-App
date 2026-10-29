import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db.js';
import { forbidden } from '../../lib/errors.js';
import { ah, paging, parse } from '../../lib/http.js';
import { authenticate, currentUser, requireRole } from '../auth/auth.js';
import { applyForBadge, definitions, providerBadges, reviewBadge, revokeBadge, verifyBadgeCode } from './badges.service.js';

export const badgesRouter = Router();

badgesRouter.get('/definitions', ah(async (_req, res) => res.json(await definitions())));

/** Public: a customer types or scans the code on a handyman's badge. */
badgesRouter.get('/verify/:code', ah(async (req, res) => res.json(await verifyBadgeCode(req.params.code))));

badgesRouter.get(
  '/mine',
  authenticate,
  requireRole('provider'),
  ah(async (req, res) => {
    const u = currentUser(req);
    if (!u.providerId) throw forbidden('Register as a provider first');
    res.json(await providerBadges(u.providerId));
  }),
);

badgesRouter.post(
  '/apply',
  authenticate,
  requireRole('provider'),
  ah(async (req, res) => {
    const u = currentUser(req);
    if (!u.providerId) throw forbidden('Register as a provider first');
    const b = parse(
      z.object({
        badgeCode: z.string(),
        documents: z.array(z.object({ type: z.string(), url: z.string().min(1), number: z.string().max(60).optional() })).min(1).max(10),
      }),
      req.body,
    );
    res.status(201).json(await applyForBadge(u.providerId, b.badgeCode, b.documents));
  }),
);

// ───────── Admin review queue ─────────
badgesRouter.get(
  '/applications',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    res.json(
      await query(
        `SELECT pb.*, bd.name AS badge_name, bd.kind, p.business_name, u.name AS owner_name, u.phone AS owner_phone
           FROM provider_badges pb JOIN badge_definitions bd ON bd.code = pb.badge_code
           JOIN providers p ON p.id = pb.provider_id JOIN users u ON u.id = p.owner_user_id
          WHERE pb.status = $1 ORDER BY pb.created_at LIMIT $2 OFFSET $3`,
        [status, limit, offset],
      ),
    );
  }),
);

badgesRouter.post(
  '/applications/:id/review',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).optional() }), req.body);
    res.json(await reviewBadge(req.params.id, currentUser(req).id, b.decision, b.note));
  }),
);

badgesRouter.post(
  '/:id/revoke',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(z.object({ note: z.string().min(3).max(500) }), req.body);
    res.json(await revokeBadge(req.params.id, currentUser(req).id, b.note));
  }),
);
