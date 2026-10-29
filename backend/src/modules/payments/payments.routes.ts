import express, { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { ah, paging, parse } from '../../lib/http.js';
import { detectOperator, normalizeSlPhone, OPERATOR_WALLET } from '../../lib/phone.js';
import { authenticate, currentUser, requireRole } from '../auth/auth.js';
import { getSetting } from '../settings/settings.service.js';
import { balance } from '../wallet/ledger.js';
import { availableGateways } from './gateways/index.js';
import {
  createPayment, getPaymentFor, handleWebhook, publicPayment, refreshPayment, simulateSandboxCallback,
} from './payments.service.js';

export const paymentsRouter = Router();
export const webhooksRouter = Router();

const gatewayEnum = z.enum(['orange_money', 'afrimoney', 'qmoney', 'monime', 'wallet']);

/** Payment options for a number: suggests the wallet that matches the SIM network. */
paymentsRouter.get(
  '/methods',
  ah(async (req, res) => {
    const { msisdn } = parse(z.object({ msisdn: z.string().optional() }), req.query);
    let suggested: string | null = null;
    let operator: string | null = null;
    if (msisdn) {
      const op = detectOperator(normalizeSlPhone(msisdn), await getSetting('phone_prefixes'));
      operator = op;
      suggested = op === 'unknown' ? 'monime' : OPERATOR_WALLET[op];
    }
    res.json({
      operator,
      suggested,
      methods: [
        ...availableGateways().map((g) => ({ ...g, type: 'mobile_money' })),
        { code: 'wallet', name: 'FixAm wallet', type: 'wallet' },
        { code: 'cash', name: 'Cash after the job', type: 'cash' },
      ],
    });
  }),
);

const createSchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('booking'), bookingId: z.string().uuid(), gateway: gatewayEnum, msisdn: z.string().optional() }),
  z.object({ purpose: z.literal('wallet_topup'), amountMinor: z.number().int().min(10_00).max(50_000_00), gateway: gatewayEnum.exclude(['wallet']), msisdn: z.string() }),
  z.object({ purpose: z.literal('subscription'), planId: z.string().uuid(), gateway: gatewayEnum, msisdn: z.string().optional() }),
  z.object({ purpose: z.literal('cash_settlement'), amountMinor: z.number().int().positive().optional(), gateway: gatewayEnum.exclude(['wallet']), msisdn: z.string() }),
]);

/**
 * Starts a mobile money collection. Requires an Idempotency-Key header; the amount is always computed
 * server-side from the booking/plan/balance, never taken from the client (except wallet top-ups).
 */
paymentsRouter.post(
  '/',
  authenticate,
  ah(async (req, res) => {
    const user = currentUser(req);
    const key = req.header('Idempotency-Key');
    if (!key || key.length < 8 || key.length > 100) throw badRequest('idempotency_key_required', 'Send a unique Idempotency-Key header (8-100 chars)');
    const b = parse(createSchema, req.body);

    let payment;
    switch (b.purpose) {
      case 'booking': {
        const booking = await one('SELECT * FROM bookings WHERE id = $1', [b.bookingId]);
        if (!booking || booking.customer_id !== user.id) throw notFound('Booking');
        if (booking.status === 'cancelled') throw conflict('booking_cancelled', 'This booking was cancelled');
        if (['paid', 'refunded'].includes(booking.payment_status)) throw conflict('already_paid', 'This booking is already paid');
        const live = await one(
          `SELECT * FROM payments WHERE booking_id = $1 AND status IN ('initiated','pending') AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
          [booking.id],
        );
        if (live && live.idempotency_key !== key) throw conflict('payment_in_progress', 'A payment for this booking is waiting for approval', { paymentId: live.id });
        payment = await createPayment({
          userId: user.id, purpose: 'booking', gateway: b.gateway, msisdn: b.msisdn ?? user.phone, amountMinor: booking.total_minor,
          idempotencyKey: key, bookingId: booking.id, description: `FixAm booking ${booking.code}`, reference: booking.code,
        });
        break;
      }
      case 'wallet_topup':
        payment = await createPayment({
          userId: user.id, purpose: 'wallet_topup', gateway: b.gateway, msisdn: b.msisdn, amountMinor: b.amountMinor,
          idempotencyKey: key, description: 'FixAm wallet top-up', reference: `TOPUP-${user.id.slice(0, 8)}`,
        });
        break;
      case 'subscription': {
        if (user.role !== 'provider' || !user.providerId) throw forbidden('Only providers can buy subscriptions');
        const plan = await one(`SELECT * FROM commission_plans WHERE id = $1 AND active AND model IN ('subscription','hybrid')`, [b.planId]);
        if (!plan) throw notFound('Subscription plan');
        const prior = await one('SELECT subscription_id FROM payments WHERE user_id = $1 AND idempotency_key = $2', [user.id, key]);
        const open = await one(
          `SELECT id FROM provider_subscriptions WHERE provider_id = $1 AND plan_id = $2 AND status = 'pending_payment' ORDER BY created_at DESC LIMIT 1`,
          [user.providerId, plan.id],
        );
        const subId =
          prior?.subscription_id ??
          open?.id ??
          (await one(`INSERT INTO provider_subscriptions (provider_id, plan_id) VALUES ($1,$2) RETURNING id`, [user.providerId, plan.id])).id;
        payment = await createPayment({
          userId: user.id, purpose: 'subscription', gateway: b.gateway, msisdn: b.msisdn ?? user.phone, amountMinor: plan.subscription_fee_minor,
          idempotencyKey: key, subscriptionId: subId, providerId: user.providerId, description: `FixAm ${plan.name} plan`, reference: `SUB-${subId.slice(0, 8)}`,
        });
        break;
      }
      case 'cash_settlement': {
        if (user.role !== 'provider' || !user.providerId) throw forbidden('Only providers settle cash commission');
        const owed = -(await balance('provider', user.providerId));
        if (owed <= 0) throw conflict('nothing_owed', 'You do not owe any commission');
        const amount = Math.min(b.amountMinor ?? owed, owed);
        payment = await createPayment({
          userId: user.id, purpose: 'cash_settlement', gateway: b.gateway, msisdn: b.msisdn, amountMinor: amount,
          idempotencyKey: key, providerId: user.providerId, description: 'FixAm commission on cash jobs', reference: `SETTLE-${user.providerId.slice(0, 8)}`,
        });
        break;
      }
    }
    res.status(201).json(publicPayment(payment));
  }),
);

paymentsRouter.get(
  '/',
  authenticate,
  ah(async (req, res) => {
    const user = currentUser(req);
    const { limit, offset } = paging(req.query);
    const isAdmin = user.role === 'admin';
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const rows = await query(
      `SELECT p.*, u.name AS payer_name, u.phone AS payer_phone, b.code AS booking_code
         FROM payments p JOIN users u ON u.id = p.user_id LEFT JOIN bookings b ON b.id = p.booking_id
        WHERE ($1::boolean OR p.user_id = $2) AND ($3::text IS NULL OR p.status = $3)
        ORDER BY p.created_at DESC LIMIT $4 OFFSET $5`,
      [isAdmin, user.id, status, limit, offset],
    );
    res.json(rows.map(publicPayment));
  }),
);

/** Poll while the payer approves on their phone. Also asks the gateway if no callback arrived yet. */
paymentsRouter.get(
  '/:id',
  authenticate,
  ah(async (req, res) => {
    const user = currentUser(req);
    await getPaymentFor(user.id, req.params.id, user.role === 'admin');
    res.json(publicPayment(await refreshPayment(req.params.id)));
  }),
);

paymentsRouter.post(
  '/:id/simulate',
  authenticate,
  ah(async (req, res) => {
    const user = currentUser(req);
    await getPaymentFor(user.id, req.params.id, user.role === 'admin');
    const { outcome } = parse(z.object({ outcome: z.enum(['succeeded', 'failed']).optional() }), req.body ?? {});
    const result = await simulateSandboxCallback(req.params.id, outcome);
    res.json({ ...result, payment: publicPayment(await one('SELECT * FROM payments WHERE id = $1', [req.params.id])) });
  }),
);

paymentsRouter.get(
  '/admin/webhook-events',
  authenticate,
  requireRole('admin'),
  ah(async (req, res) => {
    const { limit, offset } = paging(req.query);
    res.json(await query('SELECT * FROM payment_webhook_events ORDER BY id DESC LIMIT $1 OFFSET $2', [limit, offset]));
  }),
);

// Operator callbacks need the exact raw bytes for signature verification, so this router parses text itself.
webhooksRouter.post(
  '/payments/:gateway',
  express.text({ type: '*/*', limit: '256kb' }),
  ah(async (req, res) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    const result = await handleWebhook(req.params.gateway, req.headers, raw);
    res.json({ received: true, ...result });
  }),
);
