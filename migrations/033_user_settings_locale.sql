-- Migration: Add locale and notifications_enabled to user_settings
--
-- locale drives the UI language preference, persisted server-side so it
-- follows the user across devices.

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS locale                 VARCHAR(10)  NOT NULL DEFAULT 'en',
    ADD COLUMN IF NOT EXISTS notifications_enabled  BOOLEAN      NOT NULL DEFAULT TRUE;
