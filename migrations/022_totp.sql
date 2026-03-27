-- 023_totp.sql — TOTP two-factor authentication columns.
--
-- These columns were originally added in 005_totp.sql. This migration is
-- intentionally idempotent (IF NOT EXISTS) so it is safe to run on any DB
-- state and serves as the canonical reference for the 2FA schema.
--
-- totp_secret     — Base32-encoded TOTP shared secret. NULL until the user
--                   completes setup via POST /users/@me/2fa/setup.
-- totp_enabled    — True only after the user verifies the secret with a valid
--                   code via POST /users/@me/2fa/verify.
-- totp_last_used  — Timestamp of the last accepted TOTP code. Stored so that
--                   a replayed code within the same 30-second window can be
--                   detected and rejected in a future hardening pass.

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_used  TIMESTAMPTZ;

-- Index: fast lookup of users who have 2FA enabled (e.g., admin reporting).
CREATE INDEX IF NOT EXISTS idx_users_totp_enabled
    ON users (totp_enabled)
    WHERE totp_enabled = TRUE;
