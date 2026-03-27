-- 035_platform_bans.sql
--
-- Platform-level account and IP banning.

-- Add ban columns to users table.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS banned_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ban_reason      TEXT,
    ADD COLUMN IF NOT EXISTS ban_expires_at   TIMESTAMPTZ;

-- IP ban table for blocking entire addresses.
CREATE TABLE IF NOT EXISTS platform_ip_bans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address  TEXT NOT NULL,
    reason      TEXT,
    banned_by   UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_ip_bans_ip
    ON platform_ip_bans (ip_address);
