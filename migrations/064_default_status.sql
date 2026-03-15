-- Migration: Default online status preference.
--
-- Stored in user_settings so it persists across devices.
-- Values: 'online' (default), 'idle', 'invisible'.

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS default_status TEXT NOT NULL DEFAULT 'online';
