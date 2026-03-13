-- 038: Add recovery_key_hash column for one-time account recovery keys.
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_key_hash TEXT;
