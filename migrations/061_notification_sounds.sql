-- Migration: Custom notification sound preferences.
--
-- sound_dm: sound for DM messages ('default', 'chime', 'pop', 'bell', 'none').
-- sound_server: sound for server messages.
-- sound_mention: sound for @mention alerts.

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS sound_dm      TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS sound_server  TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS sound_mention TEXT NOT NULL DEFAULT 'default';
