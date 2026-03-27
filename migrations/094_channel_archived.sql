-- 094_channel_archived.sql — Channel archiving.
--
-- Archived channels are read-only and visually greyed in the sidebar.
-- They can be unarchived by users with MANAGE_CHANNELS permission.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
