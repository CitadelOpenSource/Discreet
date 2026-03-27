-- 004_codex_schema_sync.sql
--
-- Brings the database in sync with handler code added after 001_schema.sql.
-- All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- so this migration is safe to run on any database state.
--
-- Root cause: new tables were appended to 001_schema.sql but the handler
-- code references columns/tables that were never applied to existing DBs.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. SERVERS TABLE — add missing columns
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE servers ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS default_notification_level TEXT NOT NULL DEFAULT 'all';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS verification_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS explicit_content_filter INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS system_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS vanity_code VARCHAR(32) UNIQUE;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. CHANNELS TABLE — add category support
-- ═══════════════════════════════════════════════════════════════════════

-- channel_categories must exist before channels can reference it
CREATE TABLE IF NOT EXISTS channel_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_server ON channel_categories(server_id);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES channel_categories(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PINNED MESSAGES
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pinned_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by   UUID NOT NULL REFERENCES users(id),
    pinned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(channel_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_pins_channel ON pinned_messages(channel_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. USER SETTINGS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_settings (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme       TEXT NOT NULL DEFAULT 'dark',
    font_size   TEXT NOT NULL DEFAULT 'medium'
                CHECK (font_size IN ('small', 'medium', 'large')),
    compact_mode BOOLEAN NOT NULL DEFAULT false,
    show_embeds  BOOLEAN NOT NULL DEFAULT true,
    dm_privacy   TEXT NOT NULL DEFAULT 'everyone'
                CHECK (dm_privacy IN ('everyone', 'friends', 'nobody')),
    friend_request_privacy TEXT NOT NULL DEFAULT 'everyone'
                CHECK (friend_request_privacy IN ('everyone', 'friends_of_friends', 'nobody')),
    notification_level TEXT NOT NULL DEFAULT 'all'
                CHECK (notification_level IN ('all', 'mentions', 'nothing')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. SERVER NOTIFICATION SETTINGS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS server_notification_settings (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    muted       BOOLEAN NOT NULL DEFAULT false,
    mute_until  TIMESTAMPTZ,
    level       TEXT NOT NULL DEFAULT 'default'
                CHECK (level IN ('default', 'all', 'mentions', 'nothing')),
    suppress_everyone BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, server_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. AUDIT LOG
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    actor_id    UUID NOT NULL REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   UUID,
    changes     JSONB,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_server ON audit_log(server_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 7. FRIENDSHIPS (also in 003 but may not have been applied)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS friendships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. MESSAGE REACTIONS (also in 002 but may not have been applied)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS message_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(32) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON message_reactions(user_id, message_id);
