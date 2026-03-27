-- 105_display_name_limits.sql — Rate-limit display name changes to 3/month.
--
-- Tracks how many times a user has changed their display name in the current
-- 30-day window. Resets automatically when the window expires.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_changes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
