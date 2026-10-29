import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { one } from '../../db.js';
import { forbidden, unauthorized } from '../../lib/errors.js';

export type Role = 'customer' | 'provider' | 'serviceman' | 'admin';

export interface AuthUser {
  id: string;
  role: Role;
  phone: string;
  name: string | null;
  providerId: string | null; // provider owned by this user, or employing this serviceman
  servicemanId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role }, config.jwtSecret, { expiresIn: config.accessTokenTtlSec });
}

async function loadUser(userId: string): Promise<AuthUser | undefined> {
  const row = await one(
    `SELECT u.id, u.role, u.phone, u.name, u.status,
            COALESCE(p.id, s.provider_id) AS provider_id, s.id AS serviceman_id
       FROM users u
       LEFT JOIN providers p ON p.owner_user_id = u.id
       LEFT JOIN servicemen s ON s.user_id = u.id AND s.active
      WHERE u.id = $1`,
    [userId],
  );
  if (!row || row.status !== 'active') return undefined;
  return {
    id: row.id,
    role: row.role,
    phone: row.phone,
    name: row.name,
    providerId: row.provider_id,
    servicemanId: row.serviceman_id,
  };
}

async function resolve(req: Request): Promise<AuthUser | undefined> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as { sub: string };
    return await loadUser(payload.sub);
  } catch {
    return undefined;
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  resolve(req)
    .then((user) => {
      if (!user) return next(unauthorized());
      req.user = user;
      next();
    })
    .catch(next);
}

/** Attaches the user when a valid token is present, but lets anonymous requests through. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  resolve(req)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
