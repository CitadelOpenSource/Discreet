-- 096_user_tiers.sql — Overhaul user tier system and add verification codes.
--
-- Standardize account tiers: unverified, verified, pro, team, admin.
-- Add verification_codes table for email verification.
-- Add founder flag for a single distinguished account.

-- Migrate existing tier values to the new system.
UPDATE users SET account_tier = 'verified' WHERE account_tier = 'free' AND email_verified = true;
UPDATE users SET account_tier = 'unverified' WHERE account_tier = 'free' AND email_verified = false;
UPDATE users SET account_tier = 'verified' WHERE account_tier = 'registered' AND email_verified = true;
UPDATE users SET account_tier = 'unverified' WHERE account_tier = 'registered' AND email_verified = false;

-- Add founder flag.
ALTER TABLE users ADD COLUMN IF NOT EXISTS founder BOOLEAN NOT NULL DEFAULT FALSE;

-- Verification codes table for 6-digit email verification.
CREATE TABLE IF NOT EXISTS verification_codes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   VARCHAR(64) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes'
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_user_id ON verification_codes (user_id);
