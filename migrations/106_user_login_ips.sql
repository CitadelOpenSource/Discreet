-- 106_user_login_ips.sql — Deduplicated login IP history per user.
--
-- Tracks every unique IP a user has logged in from, with first/last seen
-- timestamps, login count, country code (from Cloudflare), and user agent.
-- Used by admin user detail view for legal compliance (warrant/subpoena).

CREATE TABLE IF NOT EXISTS user_login_ips (
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address      VARCHAR(45) NOT NULL,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    login_count     INTEGER     NOT NULL DEFAULT 1,
    country_code    VARCHAR(2),
    user_agent      TEXT,
    is_registration BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_user_login_ips_user ON user_login_ips (user_id, last_seen_at DESC);
