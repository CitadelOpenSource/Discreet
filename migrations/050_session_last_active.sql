-- Add last_active_at to sessions for device management.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
