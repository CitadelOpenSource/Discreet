-- Migration 018: Account tiers — guest, registered, verified
-- Supports 3-tier funnel: Guest (zero friction) → Registered → Verified (email)

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_tier VARCHAR(20) NOT NULL DEFAULT 'registered';
-- Values: 'guest' (ephemeral, no password), 'registered' (username+password), 'verified' (email confirmed)

-- Guest accounts auto-expire after 30 days of inactivity
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_tier ON users(account_tier);
CREATE INDEX IF NOT EXISTS idx_users_guest_active ON users(is_guest, last_active_at) WHERE is_guest = TRUE;
