import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db.js';
import { forbidden } from '../../lib/errors.js';
import { ah, paging, parse } from '../../lib/http.js';
import { authenticate, currentUser, requireRole } from '../auth/auth.js';
import { getSetting } from '../settings/settings.service.js';
import { balance, entries } from './ledger.js';
import { approvePayout, markPayoutPaid, rejectPayout, requestPayout } from './payouts.service.js';

export const walletRouter = Router();
walletRouter.use(authenticate);

/** Customers see their FixAm wallet; providers see earnings (negative balance = commission owed on cash jobs). */
walletRouter.get(
  '/',
  ah(async (req, res) => {
    const u = currentUser(req);
    const { limit, offset } = paging(req.query);
    if (u.role === 'provider' && u.providerId) {
      const bal = await balance('provider', u.providerId);
      const pending = await query(`SELECT * FROM payouts WHERE provider_id = $1 AND status IN ('requested','approved','processing') ORDER BY created_at DESC`, [u.providerId]);
      res.json({
        account: 'provider',
        balance_minor: bal,
        available_minor: Math.max(bal, 0),
        commission_owed_minor: Math.max(-bal, 0),
        cash_commission_limit_minor: await getSetting('cash.max_commission_due_minor'),
        payout_min_minor: await getSetting('payout.min_minor'),
        payout_fee_minor: await getSetting('payout.fee_minor'),
        pending_payouts: pending,
        entries: await entries('provider', u.providerId, limit, offset),
      });
      return;
    }
    res.json({ account: 'customer', balance_minor: await balance('customer', u.id), entries: await entries('customer', u.id, limit, offset) });
  }),
);

walletRouter.post(
  '/payouts',
  requireRole('provider'),
  ah(async (req, res) => {
    const u = currentUser(req);
    if (!u.providerId) throw forbidden();
    const { amountMinor } = parse(z.object({ amountMinor: z.number().int().positive() }), req.body);
    res.status(201).json(await requestPayout(u.providerId, amountMinor));
  }),
);

walletRouter.get(
  '/payouts',
  requireRole('provider', 'admin'),
  ah(async (req, res) => {
    const u = currentUser(req);
    const { limit, offset } = paging(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    res.json(
      await query(
        `SELECT po.*, p.business_name FROM payouts po JOIN providers p ON p.id = po.provider_id
          WHERE ($1::uuid IS NULL OR po.provider_id = $1) AND ($2::text IS NULL OR po.status = $2)
          ORDER BY po.created_at DESC LIMIT $3 OFFSET $4`,
        [u.role === 'admin' ? null : u.providerId, status, limit, offset],
      ),
    );
  }),
);

walletRouter.post('/payouts/:id/approve', requireRole('admin'), ah(async (req, res) => res.json(await approvePayout(req.params.id, currentUser(req).id))));

walletRouter.post(
  '/payouts/:id/reject',
  requireRole('admin'),
  ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    res.json(await rejectPayout(req.params.id, currentUser(req).id, reason));
  }),
);

walletRouter.post(
  '/payouts/:id/mark-paid',
  requireRole('admin'),
  ah(async (req, res) => {
    const { externalRef } = parse(z.object({ externalRef: z.string().min(3) }), req.body);
    res.json(await markPayoutPaid(req.params.id, currentUser(req).id, externalRef));
  }),
);
