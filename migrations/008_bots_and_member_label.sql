-- 008_bots_and_member_label.sql
--
-- 1. Add is_bot flag to users table so bots appear as normal members.
-- 2. Add member_tab_label to servers (customizable "Users" / "Members" / etc.)
-- 3. Create server_bots table to track which bot belongs to which server and its persona.
--
-- All idempotent.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. USERS: bot flag
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_persona JSONB;

-- Index for fast bot lookups
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot) WHERE is_bot = TRUE;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SERVERS: customizable member tab label
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE servers ADD COLUMN IF NOT EXISTS member_tab_label VARCHAR(32) NOT NULL DEFAULT 'Users';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. SERVER_BOTS: which bot was spawned for which server template
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS server_bots (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona     VARCHAR(64) NOT NULL,
    description TEXT,
    avatar_url  TEXT,
    trigger_mode VARCHAR(32) NOT NULL DEFAULT 'mention',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_bots_server ON server_bots(server_id);
