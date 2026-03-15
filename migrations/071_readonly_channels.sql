-- Migration: Read-only announcement channels.
--
-- When read_only is true, only users with MANAGE_CHANNELS permission can post.
-- Other users see the input replaced with "This is a read-only channel."
-- The message text still renders normally — only posting is restricted.

ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS read_only BOOLEAN NOT NULL DEFAULT FALSE;
