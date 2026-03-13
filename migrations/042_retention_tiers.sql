-- Three-tier message retention: global → server → channel.
-- Most restrictive wins.

-- 1) Global platform settings for retention.
INSERT INTO platform_settings (key, value) VALUES
    ('default_retention_days',      '0'::jsonb),
    ('global_disappearing_default', '"off"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2) Server-level retention.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS message_retention_days INTEGER DEFAULT NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS disappearing_messages_default VARCHAR(8) DEFAULT NULL;

-- 3) Channel-level retention.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS message_retention_days INTEGER DEFAULT NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS disappearing_messages VARCHAR(8) DEFAULT NULL;

-- 4) Per-message expiration for disappearing messages.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at) WHERE expires_at IS NOT NULL;
