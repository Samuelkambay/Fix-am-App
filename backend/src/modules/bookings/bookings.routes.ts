import { Router } from 'express';
import { z } from 'zod';
import { ah, paging, parse } from '../../lib/http.js';
import { authenticate, currentUser, requireRole } from '../auth/auth.js';
import {
  acceptBooking, assignServiceman, cancelBooking, completeJob, createBooking, getBooking, listBookings, markEnRoute,
  openDispute, PAYMENT_METHODS, resolveDispute, startJob,
} from './bookings.service.js';

export const bookingsRouter = Router();
bookingsRouter.use(authenticate);

const addressSchema = z.object({
  area: z.string().min(2).max(120), // e.g. "Kissy Mess Mess"
  landmark: z.string().min(2).max(200), // e.g. "Behind the Total filling station, blue gate"
  street: z.string().max(200).optional(),
  lat: z.number().min(6.8).max(10.1).optional(),
  lng: z.number().min(-13.4).max(-10.2).optional(),
  contactPhone: z.string().optional(),
});

bookingsRouter.post(
  '/',
  ah(async (req, res) => {
    const u = currentUser(req);
    const b = parse(
      z.object({ quoteId: z.string().uuid(), address: addressSchema, notes: z.string().max(1000).optional(), paymentMethod: z.enum(PAYMENT_METHODS) }),
      req.body,
    );
    const booking = await createBooking({ id: u.id, phone: u.phone }, b);
    res.status(201).json(await getBooking(u, booking.id));
  }),
);

bookingsRouter.get(
  '/',
  ah(async (req, res) => {
    const u = currentUser(req);
    const { limit, offset } = paging(req.query);
    const scope = parse(z.enum(['customer', 'provider', 'serviceman', 'requests', 'all']).default('customer'), req.query.scope);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    res.json(await listBookings(u, scope, status, limit, offset));
  }),
);

bookingsRouter.get('/:id', ah(async (req, res) => res.json(await getBooking(currentUser(req), req.params.id))));

bookingsRouter.post('/:id/accept', ah(async (req, res) => res.json(await acceptBooking(currentUser(req), req.params.id))));

bookingsRouter.post(
  '/:id/assign',
  ah(async (req, res) => {
    const { servicemanId } = parse(z.object({ servicemanId: z.string().uuid() }), req.body);
    res.json(await assignServiceman(currentUser(req), req.params.id, servicemanId));
  }),
);

bookingsRouter.post('/:id/en-route', ah(async (req, res) => res.json(await markEnRoute(currentUser(req), req.params.id))));

const codeSchema = z.object({ code: z.string().regex(/^\d{4}$/) });

bookingsRouter.post(
  '/:id/start',
  ah(async (req, res) => res.json(await startJob(currentUser(req), req.params.id, parse(codeSchema, req.body).code))),
);

bookingsRouter.post(
  '/:id/complete',
  ah(async (req, res) => res.json(await completeJob(currentUser(req), req.params.id, parse(codeSchema, req.body).code))),
);

bookingsRouter.post(
  '/:id/cancel',
  ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(3).max(300) }), req.body);
    res.json(await cancelBooking(currentUser(req), req.params.id, reason));
  }),
);

bookingsRouter.post(
  '/:id/dispute',
  ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(5).max(1000) }), req.body);
    res.json(await openDispute(currentUser(req), req.params.id, reason));
  }),
);

bookingsRouter.post(
  '/:id/resolve',
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(z.object({ resolution: z.enum(['release', 'refund']), note: z.string().min(3).max(1000) }), req.body);
    res.json(await resolveDispute(currentUser(req), req.params.id, b.resolution, b.note));
  }),
);
