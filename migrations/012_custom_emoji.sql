-- Migration 012: Custom emoji per server
-- Server owners can upload custom emoji (images) that members can use in messages

CREATE TABLE IF NOT EXISTS custom_emojis (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        VARCHAR(32) NOT NULL,
    image_url   TEXT NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    animated    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(server_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_emojis_server ON custom_emojis(server_id);
