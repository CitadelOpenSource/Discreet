-- Migration: Message display density and chat font size preferences.
--
-- message_density: 'comfortable' (default), 'compact', 'cozy'.
-- chat_font_size: integer pixels, default 14, range 12-20.

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS message_density  TEXT    NOT NULL DEFAULT 'comfortable',
    ADD COLUMN IF NOT EXISTS chat_font_size   INTEGER NOT NULL DEFAULT 14;
