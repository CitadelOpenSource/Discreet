-- Migration 019: AI bot channels — private E2EE channels with specialist bots
-- Users can spawn private E2EE channels with AI specialist bots

CREATE TABLE IF NOT EXISTS bot_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id          UUID NOT NULL REFERENCES users(id),
    channel_name    VARCHAR(100) NOT NULL,
    bot_persona     VARCHAR(50) NOT NULL DEFAULT 'general',
    persistent      BOOLEAN NOT NULL DEFAULT FALSE,
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_channels_user ON bot_channels(user_id, last_active_at DESC);

-- Bot configuration (per-server or global bots)
CREATE TABLE IF NOT EXISTS bot_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id       UUID REFERENCES servers(id) ON DELETE CASCADE,
    persona         VARCHAR(50) NOT NULL DEFAULT 'general',
    display_name    VARCHAR(64) NOT NULL,
    description     TEXT,
    system_prompt   TEXT,
    voice_style     VARCHAR(30) DEFAULT 'default',
    temperature     REAL DEFAULT 0.7,
    max_tokens      INTEGER DEFAULT 1000,
    persistent      BOOLEAN NOT NULL DEFAULT TRUE,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(bot_user_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_configs_server ON bot_configs(server_id) WHERE server_id IS NOT NULL;
