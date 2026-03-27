-- 036_automod_configs.sql
--
-- Per-server AutoMod configuration stored as JSONB.

CREATE TABLE IF NOT EXISTS automod_configs (
    server_id  UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    config     JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
