-- 091_webhooks.sql — Outbound webhook delivery.
--
-- Stores user-configured webhooks that fire on server events.
-- Each webhook receives a signed POST with the event payload.

CREATE TABLE IF NOT EXISTS webhooks (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id     UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id    UUID        REFERENCES channels(id) ON DELETE SET NULL,
    name          VARCHAR(100) NOT NULL,
    url           TEXT        NOT NULL,
    secret        VARCHAR(64) NOT NULL,
    events        JSONB       NOT NULL DEFAULT '["message_create"]',
    enabled       BOOLEAN     DEFAULT true,
    failure_count INT         DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_server_id ON webhooks (server_id);
