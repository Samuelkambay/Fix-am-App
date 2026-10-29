-- Allow a renewal application (pending) to sit alongside the still-valid approved badge.
DROP INDEX IF EXISTS provider_badges_live_idx;
CREATE UNIQUE INDEX provider_badges_pending_idx ON provider_badges (provider_id, badge_code) WHERE status = 'pending';
CREATE UNIQUE INDEX provider_badges_approved_idx ON provider_badges (provider_id, badge_code) WHERE status = 'approved';
