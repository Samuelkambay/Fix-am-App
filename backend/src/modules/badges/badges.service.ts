import { one, query, tx, type Db, pool } from '../../db.js';
import { readableCode } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { sendSms } from '../notifications/sms.js';

export interface PerformanceCriteria {
  min_rating?: number;
  min_reviews?: number;
  min_completed?: number;
  min_completion_rate?: number;
}

/** Short code printed on the handyman's ID card / QR so customers can check it is genuine before letting them in. */
async function newVerificationCode(db: Db): Promise<string> {
  for (;;) {
    const code = `FXB-${readableCode(6)}`;
    if (!(await one('SELECT 1 FROM provider_badges WHERE verification_code = $1', [code], db))) return code;
  }
}

export async function definitions() {
  return query('SELECT * FROM badge_definitions WHERE active ORDER BY sort_order, name');
}

export async function providerBadges(providerId: string, db: Db = pool) {
  return query(
    `SELECT pb.id, pb.badge_code, pb.status, pb.verification_code, pb.review_note, pb.issued_at, pb.expires_at, pb.created_at,
            bd.name, bd.kind, bd.icon, bd.description
       FROM provider_badges pb JOIN badge_definitions bd ON bd.code = pb.badge_code
      WHERE pb.provider_id = $1 ORDER BY bd.sort_order, pb.created_at DESC`,
    [providerId],
    db,
  );
}

export async function approvedBadgeCodes(providerId: string, db: Db = pool): Promise<string[]> {
  const rows = await query(
    `SELECT badge_code FROM provider_badges WHERE provider_id = $1 AND status = 'approved' AND (expires_at IS NULL OR expires_at > now())`,
    [providerId],
    db,
  );
  return rows.map((r) => r.badge_code);
}

export async function recomputeTrustScore(providerId: string, db: Db = pool) {
  await query(
    `UPDATE providers p SET trust_score = COALESCE((
        SELECT sum(bd.trust_weight) FROM provider_badges pb JOIN badge_definitions bd ON bd.code = pb.badge_code
         WHERE pb.provider_id = p.id AND pb.status = 'approved' AND (pb.expires_at IS NULL OR pb.expires_at > now())), 0)
     WHERE p.id = $1`,
    [providerId],
    db,
  );
}

/** Grants a badge without review (phone verification, performance badges). */
export async function grantSystemBadge(providerId: string, code: string, note: string, db: Db) {
  const live =
    (await one(`SELECT id FROM provider_badges WHERE provider_id = $1 AND badge_code = $2 AND status = 'approved'`, [providerId, code], db)) ??
    (await one(`SELECT id FROM provider_badges WHERE provider_id = $1 AND badge_code = $2 AND status = 'pending'`, [providerId, code], db));
  if (live) {
    await query(`UPDATE provider_badges SET status = 'approved', issued_at = COALESCE(issued_at, now()), review_note = $2, updated_at = now() WHERE id = $1`, [live.id, note], db);
  } else {
    const def = await one('SELECT validity_days FROM badge_definitions WHERE code = $1', [code], db);
    await query(
      `INSERT INTO provider_badges (provider_id, badge_code, status, verification_code, review_note, issued_at, expires_at)
       VALUES ($1,$2,'approved',$3,$4, now(), CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5 || ' days')::interval END)`,
      [providerId, code, await newVerificationCode(db), note, def?.validity_days ?? null],
      db,
    );
  }
  await recomputeTrustScore(providerId, db);
}

export async function applyForBadge(providerId: string, code: string, documents: { type: string; url: string; number?: string }[]) {
  const def = await one('SELECT * FROM badge_definitions WHERE code = $1 AND active', [code]);
  if (!def) throw notFound('Badge');
  if (def.kind !== 'verification') throw badRequest('badge_not_requestable', 'Performance badges are earned automatically from your job history');
  const missing = (def.required_documents as string[]).filter((t) => !documents.some((d) => d.type === t));
  if (missing.length) throw badRequest('documents_missing', `Upload: ${missing.join(', ')}`, { missing });
  return tx(async (c) => {
    const pending = await one(`SELECT 1 FROM provider_badges WHERE provider_id = $1 AND badge_code = $2 AND status = 'pending'`, [providerId, code], c);
    if (pending) throw conflict('already_pending', 'This badge is already under review');
    const approved = await one(`SELECT 1 FROM provider_badges WHERE provider_id = $1 AND badge_code = $2 AND status = 'approved'`, [providerId, code], c);
    if (approved) {
      // Renewal: the old badge stays valid until the new application is decided.
      const exp = await one(
        `SELECT expires_at FROM provider_badges WHERE provider_id = $1 AND badge_code = $2 AND status = 'approved'`,
        [providerId, code],
        c,
      );
      if (!exp?.expires_at || new Date(exp.expires_at).getTime() - Date.now() > 30 * 86400_000) {
        throw conflict('already_approved', 'You already hold this badge');
      }
      // The current badge is retired only when the renewal is approved (see reviewBadge).
    }
    return one(
      `INSERT INTO provider_badges (provider_id, badge_code, documents, verification_code) VALUES ($1,$2,$3,$4) RETURNING *`,
      [providerId, code, JSON.stringify(documents), await newVerificationCode(c)],
      c,
    );
  });
}

export async function reviewBadge(id: string, reviewerId: string, decision: 'approve' | 'reject', note?: string) {
  return tx(async (c) => {
    const pb = await one(
      `SELECT pb.*, bd.validity_days, bd.name, u.phone FROM provider_badges pb
         JOIN badge_definitions bd ON bd.code = pb.badge_code
         JOIN providers p ON p.id = pb.provider_id JOIN users u ON u.id = p.owner_user_id
        WHERE pb.id = $1 FOR UPDATE OF pb`,
      [id],
      c,
    );
    if (!pb) throw notFound('Badge application');
    if (pb.status !== 'pending') throw conflict('not_pending', `Application is already ${pb.status}`);
    if (decision === 'reject' && !note) throw badRequest('note_required', 'Tell the provider why it was rejected');
    if (decision === 'approve') {
      // Approving a renewal retires the badge it replaces.
      await c.query(
        `UPDATE provider_badges SET status = 'expired', updated_at = now() WHERE provider_id = $1 AND badge_code = $2 AND status = 'approved'`,
        [pb.provider_id, pb.badge_code],
      );
    }
    const row = await one(
      `UPDATE provider_badges SET status = $2, reviewer_id = $3, review_note = $4, updated_at = now(),
              issued_at = CASE WHEN $2 = 'approved' THEN now() END,
              expires_at = CASE WHEN $2 = 'approved' AND $5::int IS NOT NULL THEN now() + ($5 || ' days')::interval END
        WHERE id = $1 RETURNING *`,
      [id, decision === 'approve' ? 'approved' : 'rejected', reviewerId, note ?? null, pb.validity_days],
      c,
    );
    await c.query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, data) VALUES ($1, $2, 'provider_badge', $3, $4)`, [
      reviewerId, `badge.${decision}`, id, JSON.stringify({ note }),
    ]);
    await recomputeTrustScore(pb.provider_id, c);
    await sendSms(
      pb.phone,
      decision === 'approve'
        ? `FixAm: your "${pb.name}" badge is approved. Customers can check it with code ${pb.verification_code}.`
        : `FixAm: your "${pb.name}" badge was not approved: ${note}. You can apply again in the app.`,
      c,
    );
    return row;
  });
}

export async function revokeBadge(id: string, actorId: string, note: string) {
  return tx(async (c) => {
    const row = await one(
      `UPDATE provider_badges SET status = 'revoked', reviewer_id = $2, review_note = $3, updated_at = now()
        WHERE id = $1 AND status = 'approved' RETURNING *`,
      [id, actorId, note],
      c,
    );
    if (!row) throw notFound('Approved badge');
    await c.query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, data) VALUES ($1,'badge.revoke','provider_badge',$2,$3)`, [actorId, id, JSON.stringify({ note })]);
    await recomputeTrustScore(row.provider_id, c);
    return row;
  });
}

/** Grants or withdraws performance badges from the provider's current stats. */
export async function evaluatePerformanceBadges(providerId: string, db: Db = pool) {
  const p = await one('SELECT rating_avg, rating_count, completed_jobs, cancelled_jobs FROM providers WHERE id = $1', [providerId], db);
  if (!p) return;
  const defs = await query(`SELECT code, criteria FROM badge_definitions WHERE kind = 'performance' AND active`, [], db);
  const held = new Set(await approvedBadgeCodes(providerId, db));
  const total = p.completed_jobs + p.cancelled_jobs;
  const completionRate = total ? p.completed_jobs / total : 0;
  for (const d of defs) {
    const c: PerformanceCriteria = d.criteria ?? {};
    const ok =
      (c.min_rating == null || p.rating_avg >= c.min_rating) &&
      (c.min_reviews == null || p.rating_count >= c.min_reviews) &&
      (c.min_completed == null || p.completed_jobs >= c.min_completed) &&
      (c.min_completion_rate == null || completionRate >= c.min_completion_rate);
    if (ok && !held.has(d.code)) await grantSystemBadge(providerId, d.code, 'Earned from job history', db);
    if (!ok && held.has(d.code)) {
      await query(
        `UPDATE provider_badges SET status = 'revoked', review_note = 'Criteria no longer met', updated_at = now()
          WHERE provider_id = $1 AND badge_code = $2 AND status = 'approved'`,
        [providerId, d.code],
        db,
      );
      await recomputeTrustScore(providerId, db);
    }
  }
}

/** Background job: expires time-limited badges (ID checks, police clearance) and refreshes trust scores. */
export async function expireBadges(): Promise<number> {
  const rows = await query(
    `UPDATE provider_badges SET status = 'expired', updated_at = now()
      WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= now() RETURNING provider_id`,
  );
  for (const pid of new Set(rows.map((r) => r.provider_id))) await recomputeTrustScore(pid);
  return rows.length;
}

/** Public, unauthenticated check of a badge code. Returns only what a customer needs to recognise the person. */
export async function verifyBadgeCode(code: string) {
  const row = await one(
    `SELECT pb.status, pb.issued_at, pb.expires_at, pb.verification_code, bd.name AS badge, bd.code AS badge_code, bd.kind,
            p.business_name, p.status AS provider_status, p.rating_avg, p.completed_jobs, u.name AS owner_name
       FROM provider_badges pb JOIN badge_definitions bd ON bd.code = pb.badge_code
       JOIN providers p ON p.id = pb.provider_id JOIN users u ON u.id = p.owner_user_id
      WHERE pb.verification_code = $1`,
    [code.trim().toUpperCase()],
  );
  if (!row) return { valid: false, reason: 'unknown_code' };
  const expired = row.expires_at && new Date(row.expires_at) <= new Date();
  const valid = row.status === 'approved' && !expired && row.provider_status === 'active';
  return {
    valid,
    reason: valid ? null : expired ? 'expired' : row.provider_status !== 'active' ? 'provider_inactive' : row.status,
    badge: row.badge,
    badgeCode: row.badge_code,
    provider: row.business_name,
    ownerName: row.owner_name,
    rating: row.rating_avg,
    completedJobs: row.completed_jobs,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
}
