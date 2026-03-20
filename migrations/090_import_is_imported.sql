-- 090_import_is_imported.sql — Flag imported messages.
--
-- Adds is_imported to all message tables so the client can distinguish
-- imported plaintext messages from native E2EE messages.

ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE group_dm_messages ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT FALSE;
