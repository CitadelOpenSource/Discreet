-- Migration 081: Disappearing messages TTL.
--
-- Adds a simple ttl_seconds column to channels and dm_channels.
-- When set (non-NULL), messages in that channel auto-expire after
-- ttl_seconds. NULL means messages persist indefinitely (default).
--
-- For DMs, ttl_set_by and ttl_set_at track who enabled the timer
-- and when, so both participants see the context.

-- ── Channels (server text channels) ─────────────────────────────────────

ALTER TABLE channels ADD COLUMN IF NOT EXISTS ttl_seconds INT DEFAULT NULL;

-- ── DM channels (1:1 conversations) ────────────────────────────────────

ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS ttl_seconds  INT         DEFAULT NULL;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS ttl_set_by   UUID        REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS ttl_set_at   TIMESTAMPTZ DEFAULT NULL;
