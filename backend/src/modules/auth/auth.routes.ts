import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, query, tx } from '../../db.js';
import { hashSecret, numericCode, randomToken, safeEqual, sha256, verifyPassword } from '../../lib/crypto.js';
import { badRequest, tooMany, unauthorized } from '../../lib/errors.js';
import { ah, parse } from '../../lib/http.js';
import { normalizeSlPhone } from '../../lib/phone.js';
import { sendSms } from '../notifications/sms.js';
import { authenticate, currentUser, signAccessToken, type Role } from './auth.js';

export const authRouter = Router();

const phoneSchema = z.string().min(6).transform(normalizeSlPhone);

async function issueTokens(userId: string, role: Role) {
  const refresh = randomToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [userId, sha256(refresh), String(config.refreshTokenTtlDays)],
  );
  return { accessToken: signAccessToken(userId, role), refreshToken: refresh, expiresIn: config.accessTokenTtlSec };
}

async function publicUser(userId: string) {
  return one(
    `SELECT u.id, u.phone, u.name, u.email, u.role, u.language, u.phone_verified_at,
            COALESCE(p.id, s.provider_id) AS provider_id, s.id AS serviceman_id
       FROM users u
       LEFT JOIN providers p ON p.owner_user_id = u.id
       LEFT JOIN servicemen s ON s.user_id = u.id AND s.active
      WHERE u.id = $1`,
    [userId],
  );
}

/** Step 1 of phone login: send a 6-digit code by SMS. */
authRouter.post(
  '/otp/request',
  ah(async (req, res) => {
    const { phone } = parse(z.object({ phone: phoneSchema }), req.body);
    const recent = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > now() - ($2 || ' seconds')::interval`,
      [phone, String(config.otpWindowSec)],
    );
    if ((recent?.n ?? 0) >= config.otpMaxPerWindow) {
      throw tooMany('Too many codes requested. Wait a few minutes and try again.');
    }
    const code = numericCode(6);
    await query(
      `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at)
       VALUES ($1, 'login', $2, now() + ($3 || ' seconds')::interval)`,
      [phone, hashSecret(`${phone}:${code}`), String(config.otpTtlSec)],
    );
    await sendSms(phone, `Your FixAm code is ${code}. It expires in 5 minutes. Do not share it with anyone, including FixAm staff.`);
    res.json({ sent: true, phone, expiresIn: config.otpTtlSec, ...(config.exposeDevOtp ? { devCode: code } : {}) });
  }),
);

/** Step 2: verify the code. Creates a customer account on first login. */
authRouter.post(
  '/otp/verify',
  ah(async (req, res) => {
    const body = parse(
      z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/), name: z.string().min(1).max(120).optional(), language: z.enum(['en', 'kri']).optional() }),
      req.body,
    );
    const user = await tx(async (c) => {
      const otp = await one(
        `SELECT * FROM otp_codes WHERE phone = $1 AND purpose = 'login' AND consumed_at IS NULL
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [body.phone],
        c,
      );
      if (!otp || new Date(otp.expires_at) < new Date()) throw badRequest('otp_expired', 'Code expired. Request a new one.');
      if (otp.attempts >= config.otpMaxAttempts) throw tooMany('Too many wrong attempts. Request a new code.');
      if (!safeEqual(otp.code_hash, hashSecret(`${body.phone}:${body.code}`))) {
        await c.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
        throw badRequest('otp_invalid', 'Wrong code');
      }
      await c.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
      const existing = await one('SELECT * FROM users WHERE phone = $1', [body.phone], c);
      if (existing) {
        if (existing.status !== 'active') throw unauthorized('This account is blocked. Contact support.');
        await c.query(
          `UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()),
                  name = COALESCE(name, $2), language = COALESCE($3, language) WHERE id = $1`,
          [existing.id, body.name ?? null, body.language ?? null],
        );
        return { id: existing.id as string, role: existing.role as Role, isNew: false };
      }
      const created = await one(
        `INSERT INTO users (phone, name, language, phone_verified_at) VALUES ($1, $2, $3, now()) RETURNING id, role`,
        [body.phone, body.name ?? null, body.language ?? 'en'],
        c,
      );
      return { id: created.id as string, role: created.role as Role, isNew: true };
    });
    res.json({ ...(await issueTokens(user.id, user.role)), isNewUser: user.isNew, user: await publicUser(user.id) });
  }),
);

/** Password login for the admin panel. */
authRouter.post(
  '/login',
  ah(async (req, res) => {
    const body = parse(z.object({ phone: phoneSchema, password: z.string().min(1) }), req.body);
    const user = await one('SELECT * FROM users WHERE phone = $1 AND status = $2', [body.phone, 'active']);
    if (!user || !verifyPassword(body.password, user.password_hash)) throw unauthorized('Wrong phone number or password');
    res.json({ ...(await issueTokens(user.id, user.role)), user: await publicUser(user.id) });
  }),
);

/** Rotates the refresh token. */
authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(10) }), req.body);
    const row = await one(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(refreshToken)],
    );
    if (!row) throw unauthorized('Session expired. Log in again.');
    const user = await one('SELECT id, role FROM users WHERE id = $1 AND status = $2', [row.user_id, 'active']);
    if (!user) throw unauthorized();
    res.json(await issueTokens(user.id, user.role));
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string() }), req.body);
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [sha256(refreshToken)]);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    res.json(await publicUser(currentUser(req).id));
  }),
);

authRouter.patch(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const body = parse(
      z.object({ name: z.string().min(1).max(120).optional(), email: z.string().email().optional(), language: z.enum(['en', 'kri']).optional() }),
      req.body,
    );
    await query(
      `UPDATE users SET name = COALESCE($2, name), email = COALESCE($3, email), language = COALESCE($4, language) WHERE id = $1`,
      [currentUser(req).id, body.name ?? null, body.email ?? null, body.language ?? null],
    );
    res.json(await publicUser(currentUser(req).id));
  }),
);
