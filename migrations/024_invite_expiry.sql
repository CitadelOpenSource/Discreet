-- 025_invite_expiry.sql — Ensure invite expiration / usage-tracking columns exist.
--
-- The columns were present in 001_schema.sql for fresh installs.
-- ADD COLUMN IF NOT EXISTS makes this migration safe to run against both
-- new databases and older ones that pre-date the 001 schema revision.

ALTER TABLE server_invites ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ;
ALTER TABLE server_invites ADD COLUMN IF NOT EXISTS max_uses    INTEGER      DEFAULT NULL;
ALTER TABLE server_invites ADD COLUMN IF NOT EXISTS use_count   INTEGER      NOT NULL DEFAULT 0;

-- Partial index: speeds up filtering and pruning of expired invites.
CREATE INDEX IF NOT EXISTS idx_server_invites_expires_at
    ON server_invites (expires_at)
    WHERE expires_at IS NOT NULL;
