-- 005_totp.sql — Add TOTP 2FA columns to users table
-- Enables time-based one-time password (TOTP) two-factor authentication.
-- totp_secret stores the base32-encoded shared secret (NULL = not set up).
-- totp_enabled is the user-facing toggle (only true after verification).

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
