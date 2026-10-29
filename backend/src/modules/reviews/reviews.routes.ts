import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db.js';
import { conflict, notFound } from '../../lib/errors.js';
import { ah, paging, parse } from '../../lib/http.js';
import { authenticate, currentUser } from '../auth/auth.js';
import { evaluatePerformanceBadges } from '../badges/badges.service.js';

export const reviewsRouter = Router();

reviewsRouter.post(
  '/',
  authenticate,
  ah(async (req, res) => {
    const u = currentUser(req);
    const b = parse(z.object({ bookingId: z.string().uuid(), rating: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() }), req.body);
    const review = await tx(async (c) => {
      const booking = await one('SELECT * FROM bookings WHERE id = $1 AND customer_id = $2', [b.bookingId, u.id], c);
      if (!booking) throw notFound('Booking');
      if (booking.status !== 'completed') throw conflict('not_completed', 'You can rate a job once it is completed');
      const r = await one(
        `INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (booking_id) DO NOTHING RETURNING *`,
        [booking.id, u.id, booking.provider_id, b.rating, b.comment ?? null],
        c,
      );
      if (!r) throw conflict('already_reviewed', 'You already rated this job');
      // Incremental average: keeps ratings carried over from before the provider joined (no review rows for those).
      await c.query(
        `UPDATE providers SET rating_avg = round(((rating_avg * rating_count + $2) / (rating_count + 1))::numeric, 2),
                rating_count = rating_count + 1
          WHERE id = $1`,
        [booking.provider_id, b.rating],
      );
      return r;
    });
    await evaluatePerformanceBadges(review.provider_id);
    res.status(201).json(review);
  }),
);

reviewsRouter.get(
  '/provider/:providerId',
  ah(async (req, res) => {
    const { limit, offset } = paging(req.query);
    res.json(
      await query(
        `SELECT r.rating, r.comment, r.created_at, split_part(u.name, ' ', 1) AS customer_first_name, s.name AS service_name
           FROM reviews r JOIN users u ON u.id = r.customer_id JOIN bookings b ON b.id = r.booking_id JOIN services s ON s.id = b.service_id
          WHERE r.provider_id = $1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
        [req.params.providerId, limit, offset],
      ),
    );
  }),
);
