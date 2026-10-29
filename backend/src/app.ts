import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { errorHandler } from './lib/http.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { badgesRouter } from './modules/badges/badges.routes.js';
import { bookingsRouter } from './modules/bookings/bookings.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { commissionRouter } from './modules/commission/commission.routes.js';
import { paymentsRouter, webhooksRouter } from './modules/payments/payments.routes.js';
import { pricingRouter } from './modules/pricing/pricing.routes.js';
import { providersRouter } from './modules/providers/providers.routes.js';
import { reviewsRouter } from './modules/reviews/reviews.routes.js';
import { uploadsRouter } from './modules/uploads/uploads.routes.js';
import { ussdRouter } from './modules/ussd/ussd.routes.js';
import { walletRouter } from './modules/wallet/wallet.routes.js';
import { zonesRouter } from './modules/zones/zones.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors());

  const api = express.Router();
  // Raw-body routes first: webhooks need exact bytes for signatures, USSD is form-encoded, uploads are binary.
  api.use('/webhooks', webhooksRouter);
  api.use('/ussd', ussdRouter);
  api.use('/uploads', uploadsRouter);

  api.use(express.json({ limit: '200kb' }));
  api.get('/health', (_req, res) => res.json({ ok: true, service: 'fixam-api', time: new Date().toISOString() }));
  api.use('/auth', authRouter);
  api.use('/zones', zonesRouter);
  api.use('/catalog', catalogRouter);
  api.use('/pricing', pricingRouter);
  api.use('/providers', providersRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/payments', paymentsRouter);
  api.use('/wallet', walletRouter);
  api.use('/commission', commissionRouter);
  api.use('/badges', badgesRouter);
  api.use('/reviews', reviewsRouter);
  api.use('/admin', adminRouter);
  api.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } }));

  app.use('/api/v1', api);
  app.use(errorHandler);
  return app;
}
