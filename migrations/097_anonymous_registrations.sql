-- 097_anonymous_registrations.sql — Detailed logging for anonymous account creation.
--
-- Captures IP addresses (including Cloudflare headers that bypass VPNs),
-- user agent, browser fingerprint hash, and Turnstile verification tokens.
-- Used for abuse prevention and NCMEC/law enforcement compliance.

CREATE TABLE IF NOT EXISTS anonymous_registrations (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_ip         VARCHAR(45) NOT NULL,
    forwarded_for           VARCHAR(500),
    cf_connecting_ip        VARCHAR(45),
    cf_ipcountry            VARCHAR(2),
    user_agent              TEXT        NOT NULL,
    accept_language         VARCHAR(500),
    screen_fingerprint_hash VARCHAR(64),
    turnstile_token         VARCHAR(2048),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anonymous_registrations_user_id ON anonymous_registrations (user_id);
CREATE INDEX IF NOT EXISTS idx_anonymous_registrations_ip ON anonymous_registrations (registration_ip);

-- Add last_login_ip tracking to users table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(45);
