-- Migration: Device verification for sessions.
--
-- device_verified: TRUE when the user has confirmed the emoji sequence matches.
-- verification_emoji: 6-emoji sequence derived from session token hash.
-- Stored for display during verification flow — not a secret.

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS device_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS verification_emoji TEXT;
