-- ═══════════════════════════════════════════════════════════════════════════
-- 006: Channel permissions, locking, visibility, message TTL, file metadata
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. CHANNEL ENHANCEMENTS ────────────────────────────────────────────

-- Lock a channel: only roles with explicit override or MANAGE_CHANNELS can post
ALTER TABLE channels ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Visibility: minimum role position required to see this channel.
-- 0 = @everyone (default), higher = more restricted.
-- NULL = everyone can see (same as 0).
ALTER TABLE channels ADD COLUMN IF NOT EXISTS min_role_position INTEGER NOT NULL DEFAULT 0;

-- Slowmode: seconds between messages per user (0 = off)
ALTER TABLE channels ADD COLUMN IF NOT EXISTS slowmode_seconds INTEGER NOT NULL DEFAULT 0;

-- NSFW flag
ALTER TABLE channels ADD COLUMN IF NOT EXISTS nsfw BOOLEAN NOT NULL DEFAULT FALSE;

-- Message TTL: auto-delete messages older than this (seconds). 0 = never expire.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS message_ttl_seconds BIGINT NOT NULL DEFAULT 0;

-- ── 2. PER-CHANNEL ROLE PERMISSION OVERRIDES ───────────────────────────
-- Allows granting or denying specific permissions on a per-channel basis.
-- `allow` bits are OR'd into the effective permissions for that channel.
-- `deny` bits mask out permissions for that channel (deny wins over allow).

CREATE TABLE IF NOT EXISTS channel_permission_overrides (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id     UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    allow_bits     BIGINT NOT NULL DEFAULT 0,
    deny_bits      BIGINT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_chan_perm_overrides_channel
    ON channel_permission_overrides(channel_id);

-- ── 3. FILE METADATA ENHANCEMENTS ──────────────────────────────────────

ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS original_filename VARCHAR(512);
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS height INTEGER;

-- ── 4. MESSAGE EXPIRATION TRACKING ─────────────────────────────────────
-- Index for efficient expired message cleanup
CREATE INDEX IF NOT EXISTS idx_messages_created_channel
    ON messages(channel_id, created_at);
