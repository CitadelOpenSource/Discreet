-- Migration 080: Waitlist referral codes.
--
-- Adds a unique referral code per waitlist entry so users can share
-- a link that credits them when friends join.

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12) UNIQUE;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES waitlist(id);
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS referral_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_waitlist_referral_code
    ON waitlist(referral_code) WHERE referral_code IS NOT NULL;
